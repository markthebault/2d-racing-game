import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.addInitScript(()=>{const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);this.addEventListener('message',({data:m})=>{if(m.type==='stats')window.rlStats=m.stats;if(m.type==='error')window.rlError=m.message;});}};});
const wait=predicate=>page.waitForFunction(predicate,null,{timeout:120000});
try{
 await page.goto('http://100.90.198.2:8088/');await page.getByRole('button',{name:'Train AI',exact:true}).click();await wait(()=>window.rlStats?.status==='ready');
 assert.equal(await page.locator('.track-option').count(),5);
 for(let track=0;track<5;track++){
  await page.locator('.track-option').nth(track).click();await page.waitForFunction(t=>window.rlStats.track===t,track);
  await page.waitForTimeout(400);await page.locator('.game-view').screenshot({path:`/tmp/circuit-${track}.png`});
 }
 console.log('Captured five track layouts.');
 await page.getByLabel('Train on Pine bend',{exact:true}).uncheck();assert.equal(await page.getByRole('button',{name:'Apply training setup'}).isDisabled(),true);
 await page.getByLabel('Train on Coastal sweep',{exact:true}).check();
 await page.getByLabel('Train on Desert switchback',{exact:true}).uncheck();await page.getByLabel('Train on Slate canyon',{exact:true}).check();
 await page.getByRole('button',{name:'Apply training setup'}).click();await wait(()=>window.rlStats.status==='ready'&&window.rlStats.trainingTracks.join(',')==='0,3,4');
 await page.locator('.training-actions select').first().selectOption('0');await page.getByLabel('Guided warm-up before RL',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Start training',exact:true}).click();
 await wait(()=>window.rlStats.history.length>=12&&window.rlStats.updates>0);
 await page.getByRole('button',{name:'Pause all',exact:true}).click();await wait(()=>window.rlStats.status==='paused');
 const before=await page.evaluate(()=>window.rlStats);
 assert.deepEqual([...new Set(before.history.map(r=>r.track))].sort(),[0,3,4]);assert.ok(before.history.some(r=>r.startFraction>0));
 await page.locator('.track-option').nth(1).click();await wait(()=>window.rlStats.track===1);
 assert.equal(await page.evaluate(()=>window.rlStats.steps),before.steps);assert.deepEqual(await page.evaluate(()=>window.rlStats.trainingTracks),[0,3,4]);
 await page.screenshot({path:'/tmp/multitrack-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.locator('.training-plan').scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/tmp/multitrack-mobile.png'});
 assert.equal(await page.evaluate(()=>window.rlError),undefined);assert.deepEqual(errors,[]);
 console.log('PASS: five layouts, exactly-three selection, shared learner, varied starts, independent view, pause and mobile layout.');
} catch(error){console.error(await page.evaluate(()=>({stats:window.rlStats,error:window.rlError})).catch(()=>null));throw error;}finally{await browser.close();}
