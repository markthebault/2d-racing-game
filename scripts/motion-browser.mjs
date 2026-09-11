import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);this.addEventListener('message',({data:m})=>{if(m.type==='stats')window.stats=m.stats;if(m.type==='error')window.rlError=m.message;});}};});
const wait=predicate=>page.waitForFunction(predicate,null,{timeout:60000});
try{
 await page.goto('http://100.90.198.2:8088/');
 await page.getByRole('button',{name:'Train AI',exact:true}).click();await wait(()=>window.stats?.status==='ready');
 const control=page.getByLabel('Minimum movement / 1 s',{exact:true});assert.equal(await control.inputValue(),'1');
 await page.locator('.training-actions select').first().selectOption('0');
 await page.getByRole('button',{name:'Start training',exact:true}).click();await wait(()=>window.stats?.steps>280&&window.stats?.best);
 await page.getByRole('button',{name:'Pause all',exact:true}).click();await wait(()=>window.stats.status==='paused');
 const before=await page.evaluate(()=>window.stats);
 await control.selectOption('2');await wait(()=>window.stats.minDistance===2&&window.stats.status==='ready');
 const after=await page.evaluate(()=>window.stats);assert.equal(after.steps,before.steps);assert.equal(after.updates,before.updates);assert.equal(after.replaySize,0);assert.equal(after.best.evaluation.minDistance,2);
 await page.getByRole('button',{name:/Pine bend/}).click();await wait(()=>window.stats.track===1&&window.stats.status==='ready');assert.equal(await control.inputValue(),'2');
 await page.getByRole('button',{name:'Run best model',exact:true}).click();await page.waitForFunction(steps=>window.stats.backgroundLearning&&window.stats.steps>steps,after.steps,{timeout:60000});
 await page.setViewportSize({width:390,height:844});await control.scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/tmp/racing-motion-mobile.png'});
 assert.equal(await page.evaluate(()=>window.rlError),undefined);assert.deepEqual(errors,[]);
 console.log('Passed: threshold UI, retained weights/counters, cleared experience memory, fresh evaluation, track transfer, background learning and mobile layout.');
}finally{await browser.close();}
