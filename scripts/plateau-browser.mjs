import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);this.addEventListener('message',({data:m})=>{if(m.type==='stats'){window.rlStats=m.stats;}if(m.type==='error')window.rlError=m.message;});}};});
const wait=async fn=>{try{await page.waitForFunction(fn,null,{timeout:600000});}catch(e){console.log(await page.evaluate(()=>window.rlStats));throw e;}};
try{
 await page.goto('http://100.90.198.2:8088/');await page.getByRole('button',{name:'Train AI',exact:true}).click();await wait(()=>window.rlStats?.status==='ready');assert.equal(await page.evaluate(()=>window.rlStats.preset),'local');
 await page.locator('.training-actions select').first().selectOption('0');await page.getByRole('button',{name:'Start training',exact:true}).click();await wait(()=>window.rlStats.status==='coaching'); await page.getByRole('button',{name:'Pause all',exact:true}).click(); await wait(()=>window.rlStats.status==='paused'); const warmup=await page.evaluate(()=>window.rlStats.coachUpdates); await page.waitForTimeout(300); assert.equal(await page.evaluate(()=>window.rlStats.coachUpdates),warmup); await page.getByRole('button',{name:'Resume all',exact:true}).click(); await wait(()=>window.rlStats.updates>1&&window.rlStats.best); assert.equal(await page.evaluate(()=>window.rlStats.coachUpdates),4000); assert.equal(await page.evaluate(()=>window.rlStats.best.trainedTracks.length),3);
 await page.getByRole('button',{name:'Pause all',exact:true}).click();await wait(()=>window.rlStats.status==='paused');const before=await page.evaluate(()=>({steps:window.rlStats.steps,updates:window.rlStats.updates}));
 await page.getByRole('button',{name:'Test all 5 tracks',exact:true}).click();await wait(()=>window.rlStats.status==='ready'&&window.rlStats.validation?.results.length===5);
 assert.equal(await page.evaluate(()=>window.rlStats.steps),before.steps);assert.equal(await page.evaluate(()=>window.rlStats.updates),before.updates);
 await page.getByLabel('Chart circuit',{exact:true}).selectOption('2');await page.getByRole('region',{name:'Transfer check',exact:true}).scrollIntoViewIfNeeded();
 assert.equal(await page.getByRole('region',{name:'Transfer check',exact:true}).getByText(/Held out/).count(),2);
 await page.screenshot({path:'/tmp/plateau-desktop.png'});await page.setViewportSize({width:390,height:844});await page.getByRole('region',{name:'Transfer check',exact:true}).scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/tmp/plateau-mobile.png'});
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.rlError),undefined);console.log('PASS: guided warm-up, pause/resume, live browser RL, read-only transfer check, per-track charts, held-out labels and mobile layout.');
}finally{await browser.close();}
