import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1100,height:900}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>raf(t=>setTimeout(()=>fn(t),100));const W=window.Worker;window.Worker=class extends W {constructor(...args){super(...args);const post=this.postMessage.bind(this);this.postMessage=(m,...rest)=>{if(m.type==='init')window.lastInit=m;post(m,...rest);};this.addEventListener('message',({data})=>{if(data.type==='insight')window.reading=data.reading;});}};});
 await page.goto('http://100.90.198.2:8088/');
 await page.getByRole('button',{name:'Train AI',exact:true}).click();
 await page.getByText('Input parameters & experiment',{exact:true}).click();
 await page.getByRole('button',{name:'Sensors and car only',exact:true}).click();
 assert.equal(await page.locator('.training-feature-controls input:checked').count(),3);
 await page.getByRole('button',{name:'Start fresh session',exact:true}).click();
 await page.waitForFunction(()=>window.lastInit?.features?.preview===false);
 await page.getByRole('tab',{name:'Learn',exact:true}).click();
 await page.getByRole('button',{name:/See how the AI learns/}).click();
 await page.waitForFunction(()=>window.reading?.network?.inputs?.length===52);
 const inputs=await page.evaluate(()=>window.reading.network.inputs);
 for(const i of [16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45])assert.equal(inputs[i],0);
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('tab',{name:'Train',exact:true}).click();
 await page.getByText('Input parameters & experiment',{exact:true}).click();
 await page.locator('.training-feature-controls').scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/training-features-mobile.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: feature selection, fresh worker settings, actual masked observations, mobile layout');
} finally {await browser.close();}
