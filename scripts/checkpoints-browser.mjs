import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.addInitScript(()=>{
  const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{
    constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='stats')window.rlStats=data.stats;if(data.type==='frame')window.rlFrame=data.frame;if(data.type==='error')window.rlError=data.message;});}
  };
});
const wait=fn=>page.waitForFunction(fn,null,{timeout:90000});
try{
  await page.goto(process.env.RACING_URL||'http://100.90.198.2:8088/');
  await page.getByRole('button',{name:'Train AI',exact:true}).click();
  await wait(()=>window.rlStats?.status==='ready'&&window.rlStats.targetLaps===3);
  assert.equal(await page.evaluate(()=>window.rlStats.checkpointCount),4);
  assert.equal(await page.getByLabel('Number of laps').isDisabled(),false);
  await page.locator('.training-actions select').first().selectOption('0');
  await page.getByRole('button',{name:'Start training',exact:true}).click();
  await wait(()=>window.rlStats?.best?.evaluation);
  await page.locator('.train-button').click();await wait(()=>window.rlStats?.status==='paused');
  const before=await page.evaluate(()=>window.rlStats);
  await page.getByLabel('Number of laps').fill('2');
  await wait(()=>window.rlStats?.targetLaps===2&&window.rlStats.status==='ready');
  const after=await page.evaluate(()=>window.rlStats);
  assert.equal(after.steps,before.steps);assert.equal(after.replaySize,before.replaySize);assert.equal(after.best.evaluation.targetLaps,2);
  await page.getByLabel('Number of laps').fill('3');await wait(()=>window.rlStats?.targetLaps===3&&window.rlStats.status==='ready');
  for(const [name,count,track] of [['Pine bend',6,1],['Desert switchback',8,2],['Park oval',4,0]]){
    await page.getByRole('button',{name:new RegExp(name)}).click();await wait(()=>window.rlStats?.status==='ready');
    await page.waitForFunction(t=>window.rlStats?.track===t&&window.rlStats.status==='ready',track);
    const s=await page.evaluate(()=>window.rlStats);assert.equal(s.checkpointCount,count);assert.equal(s.targetLaps,3);assert.equal(s.steps,before.steps);
    await page.screenshot({path:`/tmp/checkpoints-track-${track}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'Run best model',exact:true}).click();await wait(()=>window.rlFrame?.targetLaps===3);
  assert.equal(await page.evaluate(()=>window.rlFrame.checkpointCount),4);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/checkpoints-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.evaluate(()=>window.rlError),undefined);assert.deepEqual(errors,[]);
  console.log('Browser passed: editable AI lap count, retained learner across lap/track changes, 4/6/8 checkpoints, lap-aware evaluation/playback, desktop/mobile rendering, no browser errors.');
} catch(error){console.error(await page.evaluate(()=>({stats:window.rlStats,error:window.rlError})));throw error;}finally{await browser.close();}
