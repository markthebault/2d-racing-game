import { registerRaceTools } from './webmcp';
import * as THREE from 'three';
import { TRACKS, ROAD_WIDTH, ROAD_EDGE_OFFSET, offsetTrackPoint, trackEdges, trackBounds, sampleTrack, nearestPoint, advanceProgress, type Progress } from './race';
import { senseTrack, type EdgeSegment, type RayReading } from './sensors';
import { SensorOverlay } from './sensor-overlay';
import { ProgressiveSteering } from './steering';
import { drivingInput, vehicleTelemetry, type VehicleTelemetry } from './telemetry';

import { stepVehicle } from './vehicle';
import type { AgentFrame } from './rl/environment';

export type RaceStats = {status:'ready'|'countdown'|'racing'|'paused'|'finished';speed:number;lap:number;time:number;best:number;countdown:number;offroad:boolean;rays:RayReading[];vehicle:VehicleTelemetry};
export class RaceEngine {
  private external = false;
  private agentFrame: AgentFrame | null = null;
  private unregisterTools: () => void = () => {};
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-60,60,42,-42,.1,300);
  private renderer: THREE.WebGLRenderer;
  private car = new THREE.Group();
  private points: THREE.Vector3[];
  private bounds: ReturnType<typeof trackBounds>;
  private roadScale: number;
  private edges: EdgeSegment[];
  private sensorOverlay: SensorOverlay;
  private keys = new Set<string>();
  private steering = new ProgressiveSteering();
  private frame = 0;
  private last = 0;
  private hudTime = 0;
  private countdownTime = 0;
  private lapStart = 0;
  private heading = 0;
  private progress: Progress = {previous:0,distance:0,laps:0};
  private resizeObserver: ResizeObserver;
  private stats: RaceStats = {status:'ready',speed:0,lap:0,time:0,best:0,countdown:3,offroad:false,rays:[],vehicle:vehicleTelemetry()};
  constructor(private host: HTMLDivElement, private track: number, private laps: number, private onStats: (stats:RaceStats)=>void) {
    this.renderer = new THREE.WebGLRenderer({antialias:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.setClearColor('#273c34');
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label','Top-down racing circuit with one orange car');
    this.points=sampleTrack(track);
    this.bounds=trackBounds(this.points);
    this.roadScale=TRACKS[track].roadScale;
    this.edges=trackEdges(this.points,ROAD_EDGE_OFFSET*this.roadScale);
    this.sensorOverlay=new SensorOverlay(this.scene);
    this.scene.add(new THREE.AmbientLight(0xffffff,1.6));
    const sun=new THREE.DirectionalLight(0xfff4da,2.4);sun.position.set(-30,80,30);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-120;sun.shadow.camera.right=120;sun.shadow.camera.top=100;sun.shadow.camera.bottom=-100;sun.shadow.normalBias=.05;this.scene.add(sun);
    this.camera.position.set(0,100,0);this.camera.up.set(0,0,-1);this.camera.lookAt(0,0,0);
    this.buildTrack(); this.buildCar(); this.reset();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
    window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);window.addEventListener('blur',this.blur);document.addEventListener('visibilitychange',this.visibility);
    this.unregisterTools=registerRaceTools(this.start,()=>({...this.stats}));
    this.frame=requestAnimationFrame(this.tick);
  }
  private box(w:number,h:number,d:number,color:THREE.ColorRepresentation,x=0,y=0,z=0,parent:THREE.Object3D=this.scene) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.86}));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  private ribbon(inner:number,outer:number,color:THREE.ColorRepresentation,height:number,start=0,end=this.points.length) {
    const vertices:number[]=[];
    for(let i=start;i<end;i++) {
      const quad=[];
      for(const j of [i,i+1]) {for(const width of [inner,outer]) {const p=offsetTrackPoint(this.points,j,width*this.roadScale);quad.push(new THREE.Vector3(p.x,height,p.z));}}
      for(const k of [0,2,1,1,2,3]) vertices.push(quad[k].x,quad[k].y,quad[k].z);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;this.scene.add(mesh);
  }
  private buildTrack() {
    const theme=TRACKS[this.track];
    this.box(500,.6,400,theme.ground,0,-.6,0);
    this.ribbon(-7,7,theme.edge,-.1);
    this.ribbon(-5.55,5.55,'#e7e7ce',.01);
    this.ribbon(-ROAD_EDGE_OFFSET,ROAD_EDGE_OFFSET,'#414a4b',.04);
    for(let i=0;i<600;i+=5) {const color=(i/5)%2===0?'#f3eee2':'#dc6b50';this.ribbon(-5.95,-5.2,color,.07,i,i+5);this.ribbon(5.2,5.95,color,.07,i,i+5);}
    // Short center marks make the direction and curvature easy to read.
    for(let i=10;i<600;i+=20)this.ribbon(-.07,.07,'#8a9190',.065,i,i+5);
    const start=this.points[0],t=this.points[1].clone().sub(start).normalize();
    const line=new THREE.Group();line.position.set(start.x,.1,start.z);line.rotation.y=-Math.atan2(t.z,t.x);this.scene.add(line);
    for(let row=0;row<2;row++)for(let col=0;col<10;col++)this.box(.65,.02,this.roadScale,(row+col)%2?'#252d30':'#fff9e9',(row-.5)*.65,0,(col-4.5)*this.roadScale,line);
    // Direction arrows are painted on the road.
    for(const idx of [35,180,330,470]) {const p=this.points[idx],n=this.points[(idx+1)%600].clone().sub(p).normalize();const arrow=new THREE.Group();arrow.position.set(p.x,.12,p.z);arrow.rotation.y=-Math.atan2(n.z,n.x);this.scene.add(arrow);for(const side of [-1,1]){const m=this.box(1.1,.02,.16,'#adb4a8',0,0,side*.35,arrow);m.rotation.y=side*.65;}}
    let seed=31+this.track*117;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
    for(let i=0;i<115;i++) {const x=this.bounds.minX-10+random()*(this.bounds.maxX-this.bounds.minX+20),z=this.bounds.minZ-10+random()*(this.bounds.maxZ-this.bounds.minZ+20);if(nearestPoint(this.points,x,z).distance<9||Math.hypot(x,z)<9)continue;
      const size=1+random()*1.3;
      if(this.track===2){const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(size,0),new THREE.MeshStandardMaterial({color:i%2?'#d6b986':'#95734f',roughness:1}));rock.position.set(x,.8,z);rock.scale.y=.65;rock.castShadow=true;this.scene.add(rock);}
      else {this.box(.45,2,.45,'#615840',x,.8,z);const tree=new THREE.Mesh(new THREE.ConeGeometry(size,3+size,7),new THREE.MeshStandardMaterial({color:i%3?'#274f3d':'#3c6444',roughness:1}));tree.position.set(x,2.6,z);tree.castShadow=true;this.scene.add(tree);}
    }
    // Keep the grandstand clear of the technical circuits' infield return leg.
    const standOffset=this.track===0?0:22.4;
    // Small grandstand in the infield.
    for(let row=0;row<3;row++)this.box(14,.65+row*.3,1.25,'#bcc6b8',-2,.25+row*.15,standOffset-3-row*1.4);
    this.box(15,.25,5.4,'#243e38',-2,3.4,standOffset-4.4);
    for(const x of [-8,4])this.box(.24,3.5,.24,'#d0d4c4',x,1.5,standOffset-4.4);
    // Trackside start marker.
    this.box(.3,2,.3,'#f4ecdb',start.x,.9,start.z+7.2);
    this.box(3,.12,1.4,'#f4ecdb',start.x+1.3,2,start.z+7.2);
  }
  private buildCar() {
    this.scene.add(this.car);
    this.box(3,.65,1.5,'#f4753e',0,.65,0,this.car);
    this.box(1.35,.5,1.3,'#f99557',-.2,1.15,0,this.car);
    this.box(.43,.04,1.1,'#253f46',.38,1.43,0,this.car);
    this.box(.32,.04,1.05,'#253f46',-.73,1.43,0,this.car);
    this.box(2.7,.035,.19,'#fff0ca',0,1,0,this.car);
    for(const x of [-.94,.95])for(const z of [-.8,.8])this.box(.65,.5,.27,'#1c2729',x,.4,z,this.car);
    for(const z of [-.48,.48]) {this.box(.13,.2,.3,'#fff6d2',1.51,.7,z,this.car);this.box(.1,.18,.27,'#a62e20',-1.51,.7,z,this.car);}
    this.box(.24,.15,1.9,'#233337',-1.3,1.15,0,this.car);
  }
  private resize() {const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);const aspect=w/h,b=trackBounds(this.points,18),halfHeight=Math.max((b.maxZ-b.minZ)/2,(b.maxX-b.minX)/(2*aspect));this.camera.position.set((b.minX+b.maxX)/2,100,(b.minZ+b.maxZ)/2);this.camera.left=-halfHeight*aspect;this.camera.right=halfHeight*aspect;this.camera.top=halfHeight;this.camera.bottom=-halfHeight;this.camera.updateProjectionMatrix();}
  private emit(){this.stats.vehicle=this.external && this.agentFrame ? { ...this.agentFrame.controls, steering: this.agentFrame.steering, steeringWheelAngle: this.agentFrame.steering * 90, position: {x:this.agentFrame.x,z:this.agentFrame.z}, headingDegrees: ((this.agentFrame.heading*180/Math.PI)%360+360)%360 } : vehicleTelemetry(this.car.position,this.heading,this.keys,this.stats.status==='racing',this.steering.value);this.onStats({...this.stats});}
  setExternal=(enabled:boolean)=>{this.external=enabled;this.agentFrame=null;this.reset();};
  showAgent=(frame:AgentFrame)=>{if(!this.external)return;this.agentFrame=frame;this.car.position.set(frame.x,0,frame.z);this.heading=frame.heading;this.car.rotation.y=-frame.heading;this.stats.speed=frame.speed;this.stats.time=frame.time;this.stats.lap=frame.completed?1:0;this.stats.offroad=frame.offroad;this.stats.status='racing';this.updateSensors();this.emit();};
  reset=()=>{this.stats={status:'ready',speed:0,lap:0,time:0,best:0,countdown:3,offroad:false,rays:[],vehicle:vehicleTelemetry()};this.progress={previous:0,distance:0,laps:0};this.lapStart=0;this.keys.clear();this.placeAt(0);this.emit();};
  start=()=>{if(this.external)return;this.reset();this.stats.status='countdown';this.countdownTime=3;this.emit();};
  togglePause=()=>{if(this.external)return;if(this.stats.status==='racing')this.stats.status='paused';else if(this.stats.status==='paused')this.stats.status='racing';this.keys.clear();this.steering.reset();this.emit();};
  setKey=(key:string,pressed:boolean)=>{if(this.external)return;if(pressed)this.keys.add(key);else this.keys.delete(key);};
  setRaysVisible=(visible:boolean)=>{this.sensorOverlay.group.visible=visible;};
  private updateSensors(){this.stats.rays=senseTrack(this.car.position,this.heading,this.edges);this.sensorOverlay.update(this.stats.rays);}
  private placeAt(index:number){const p=this.points[index],n=this.points[(index+1)%600];this.car.position.set(p.x,0,p.z);this.heading=Math.atan2(n.z-p.z,n.x-p.x);this.car.rotation.y=-this.heading;this.stats.speed=0;this.steering.reset();this.updateSensors();}
  private keyDown=(e:KeyboardEvent)=>{if(this.external)return;if((e.target as HTMLElement)?.matches('input,textarea,select'))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape','r','R'].includes(e.key)){e.preventDefault();if(e.key==='Escape'&&!e.repeat)this.togglePause();else if(e.key.toLowerCase()==='r'&&!e.repeat&&this.stats.status==='racing')this.placeAt(this.progress.previous);else this.setKey(e.key,true);}};
  private keyUp=(e:KeyboardEvent)=>{this.setKey(e.key,false);};
  private blur=()=>{this.keys.clear();if(this.stats.status==='racing')this.togglePause();};
  private visibility=()=>{if(document.hidden)this.blur();};
  private tick=(now:number)=>{
    const dt=Math.min((now-(this.last||now))/1000,.05);this.last=now;
    if(this.stats.status==='countdown'){this.countdownTime-=dt;this.stats.countdown=Math.ceil(this.countdownTime);if(this.countdownTime<=0)this.stats.status='racing';}
    if(!this.external&&this.stats.status==='racing') {
      this.stats.time+=dt;
      const near=nearestPoint(this.points,this.car.position.x,this.car.position.z);this.stats.offroad=near.distance>ROAD_WIDTH*this.roadScale/2;
      const input=drivingInput(this.keys,true);
      const state={x:this.car.position.x,z:this.car.position.z,heading:this.heading,speed:this.stats.speed};
      stepVehicle(state,input,this.steering,dt,this.stats.offroad,this.bounds);
      this.heading=state.heading;this.stats.speed=state.speed;this.car.position.set(state.x,0,state.z);this.car.rotation.y=-this.heading;
      const next=nearestPoint(this.points,this.car.position.x,this.car.position.z);
      if(advanceProgress(this.progress,next.index,next.distance<=5.5*this.roadScale&&near.distance<=5.5*this.roadScale,600)) {const lapTime=this.stats.time-this.lapStart;this.lapStart=this.stats.time;this.stats.best=this.stats.best?Math.min(this.stats.best,lapTime):lapTime;this.stats.lap=this.progress.laps;if(this.stats.lap>=this.laps){this.stats.status='finished';this.stats.speed=0;this.keys.clear();this.steering.reset();}}
    }
    this.updateSensors();this.renderer.render(this.scene,this.camera);this.hudTime+=dt;if(this.hudTime>.065){this.emit();this.hudTime=0;}this.frame=requestAnimationFrame(this.tick);
  };
  dispose(){this.unregisterTools();cancelAnimationFrame(this.frame);this.sensorOverlay.dispose();this.resizeObserver.disconnect();window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('blur',this.blur);document.removeEventListener('visibilitychange',this.visibility);this.scene.traverse(obj=>{if(obj instanceof THREE.Mesh){obj.geometry.dispose();const materials=Array.isArray(obj.material)?obj.material:[obj.material];materials.forEach(m=>m.dispose());}});this.renderer.dispose();this.renderer.domElement.remove();}
}
