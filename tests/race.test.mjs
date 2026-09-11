import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, advanceProgress, sampleTrack, trackCurve, nearestPoint, formatTime } from '../lib/race.ts';

test('all five tracks close, have usable road width, and project positions correctly',()=>{
  for(let track=0;track<TRACKS.length;track++) {
    const points=sampleTrack(track);
    assert.equal(points.length,600);
    assert.ok(points[0].distanceTo(points[599]) <= trackCurve(track).getLength() / 600 * 1.01);
    for(let i=0;i<600;i++) {
      assert.equal(nearestPoint(points,points[i].x,points[i].z).index,i);
      for(let j=i+50;j<i+550;j++) assert.ok(points[i].distanceTo(points[j%600])>11,'Nonadjacent road sections must not overlap');
    }
  }
});
test('each forward loop counts once, including subsequent laps',()=>{
  const state={previous:0,distance:0,laps:0};
  for(let lap=1;lap<=3;lap++){for(let i=1;i<=600;i++)advanceProgress(state,i%600,true,600);assert.equal(state.laps,lap);}
});
test('wiggling at the line and reverse laps never award laps',()=>{
  const state={previous:0,distance:0,laps:0};
  for(let i=0;i<30;i++){advanceProgress(state,599,true,600);advanceProgress(state,0,true,600);}
  assert.equal(state.laps,0);
  for(let i=599;i>=0;i--)advanceProgress(state,i,true,600);
  assert.equal(state.laps,0);
});
test('grass shortcuts and large jumps cannot award a completed lap',()=>{
  const state={previous:0,distance:0,laps:0};
  for(let i=1;i<=600;i++)advanceProgress(state,i%600,i<100||i>300,600);
  assert.equal(state.laps,0);
  assert.ok(state.distance<600);
  const teleport={previous:0,distance:0,laps:0};advanceProgress(teleport,250,true,600);assert.equal(teleport.distance,0);
});
test('race time formatting',()=>{assert.equal(formatTime(65.349),'01:05.34');assert.equal(formatTime(0),'00:00.00');});
