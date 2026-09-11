import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
// Observe real worker messages without replacing training, physics, or rendering.
await page.addInitScript(() => {
  window.__rlMessages=[];
  const OriginalWorker=window.Worker;
  window.Worker=class extends OriginalWorker {
    constructor(...args){super(...args);this.addEventListener('message',event=>{
      const m=event.data;
      if(m.type==='stats')window.__rlStats=m.stats;
      if(m.type==='fleet'&&m.frame)window.__rlFleet=m.frame;
      if(m.type==='frame')window.__rlSingleFrames=(window.__rlSingleFrames||0)+1;
      if(m.type==='error')window.__rlMessages.push(m);
    });}
  };
});
const wait = (predicate) => page.waitForFunction(predicate, null, {timeout:180000});
try {
  await page.goto(process.env.RACING_URL||'http://100.90.198.2:8088/');
  await page.getByRole('button',{name:'Train AI',exact:true}).click();
  await wait(()=>window.__rlStats?.status==='ready');
  const layout=await page.evaluate(()=>({track:document.querySelector('.track-option').getBoundingClientRect().right,canvas:document.querySelector('.race-panel').getBoundingClientRect().left}));
  assert.ok(layout.track<layout.canvas,'Circuit buttons fit beside the canvas');
  await page.locator('.training-actions select').selectOption('0');
  await page.getByRole('button',{name:'Start training',exact:true}).click();
  await wait(()=>window.__rlStats?.episode>=10);
  console.log('Browser: first 10 episodes trained without individual car frames.');
  assert.equal(await page.evaluate(()=>window.__rlSingleFrames||0),0,'Individual training and evaluation cars stay hidden');
  await wait(()=>window.__rlStats?.status==='replaying');
  const batchSteps=await page.evaluate(()=>window.__rlStats.steps);
  await page.waitForFunction(steps=>window.__rlStats?.status==='replaying'&&window.__rlStats.steps>steps,batchSteps);
  await page.getByRole('button',{name:'Pause all',exact:true}).click();
  await wait(()=>window.__rlStats?.status==='paused');
  const first=await page.evaluate(()=>({fleet:window.__rlFleet,stats:window.__rlStats}));
  assert.equal(first.fleet.poses.length,50);assert.equal(first.fleet.first,1);assert.equal(first.fleet.last,50);
  assert.ok(first.stats.episode>=50);
  console.log('Browser: first 50-car replay paused.');
  await page.screenshot({path:'/tmp/racing-batch-desktop.png',fullPage:true});
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>window.__rlFleet.time),first.fleet.time);
  await page.getByRole('button',{name:'Resume all',exact:true}).click();
  await wait(()=>window.__rlStats?.episode>50);
  await wait(()=>window.__rlStats?.status==='replaying'&&window.__rlFleet?.last===100);
  await page.getByRole('button',{name:'Pause all',exact:true}).click();await wait(()=>window.__rlStats?.status==='paused');
  assert.equal(await page.evaluate(()=>window.__rlFleet.first),51);
  console.log('Browser: second 50-car replay reached.');
  await page.getByRole('button',{name:'Skip this replay',exact:true}).click();
  await page.getByRole('button',{name:'Resume all',exact:true}).click();
  await wait(()=>window.__rlStats?.episode>100);
  await page.getByRole('button',{name:'Pause all',exact:true}).click();await wait(()=>window.__rlStats?.status==='paused');
  const before=await page.evaluate(()=>window.__rlStats);
  await page.getByRole('button',{name:/Pine bend/}).click();
  await wait(()=>window.__rlStats?.track===1&&window.__rlStats?.status==='ready');
  const after=await page.evaluate(()=>window.__rlStats);
  for(const field of ['steps','updates','replaySize','episode'])assert.equal(after[field],before[field],`${field} retained on track switch`);
  await page.getByRole('button',{name:'Resume training',exact:true}).click();
  await wait(()=>window.__rlStats?.trainedTracks.includes(1));
  await page.getByRole('button',{name:/Desert switchback/}).click();
  await wait(()=>window.__rlStats?.track===2&&window.__rlStats?.trainedTracks.includes(2));
  await page.getByRole('button',{name:'Pause all',exact:true}).click();await wait(()=>window.__rlStats?.status==='paused');
  await page.getByRole('button',{name:'Run best model',exact:true}).click();
  await wait(()=>window.__rlStats?.status==='playing');
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(()=>window.__rlSingleFrames>0));
  await page.getByRole('button',{name:'Pause all',exact:true}).click();await wait(()=>window.__rlStats?.status==='paused');
  const steps=await page.evaluate(()=>window.__rlStats.steps);
  await page.getByRole('button',{name:'Resume all',exact:true}).click();
  await wait(()=>window.__rlStats?.status==='playing');
  await page.waitForFunction(before=>window.__rlStats.steps>before,steps);
  assert.equal(await page.evaluate(()=>window.__rlStats.backgroundLearning),true);
  await page.getByRole('button',{name:'Pause all',exact:true}).click();await wait(()=>window.__rlStats?.status==='paused');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/racing-batch-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow on mobile');
  await page.locator('.model-library summary').click();
  const sourceKey=await page.locator('.model-library select').first().evaluate(select=>[...select.options].find(option=>option.text.includes('Park oval')).value);
  const originalSave=await page.evaluate(key=>localStorage.getItem(key),sourceKey);
  await page.locator('.model-library select').first().selectOption(sourceKey);
  await page.getByRole('button',{name:'Load on Desert switchback',exact:true}).click();
  await wait(()=>window.__rlStats?.track===2&&window.__rlStats?.steps===0&&window.__rlStats?.status==='ready');
  await page.getByRole('button',{name:'Start training',exact:true}).click();
  await wait(()=>window.__rlStats?.steps>0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),sourceKey),originalSave,'Loading and fine-tuning retains the source save');
  assert.deepEqual(await page.evaluate(()=>window.__rlMessages),[]);
  assert.deepEqual(errors,[]);
  console.log('Browser passed: hidden training, two real 50-car batches, natural completion, pause/resume, skip, retained learner across all circuits, best playback, saved-model fine-tuning, mobile layout, no console errors.');
} catch (error) {
  console.error('Last browser state:',await page.evaluate(()=>({stats:window.__rlStats,errors:window.__rlMessages})).catch(()=>null));
  await page.screenshot({path:'/tmp/racing-browser-failure.png',fullPage:true}).catch(()=>{});
  throw error;
} finally {await browser.close();}
