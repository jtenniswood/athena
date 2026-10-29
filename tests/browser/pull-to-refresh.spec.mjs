import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = ts.transpileModule(readFileSync('apps/web-desktop/src/experience/ui/pull-to-refresh.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

test.beforeEach(async ({page}) => {
  await page.setContent('<section role="dialog"><div id="root"><div id="scroller" style="height:150px;overflow-y:auto"><div id="target" style="height:600px">Bots</div><input></div></div></section>')
  await page.evaluate(source => {
    const api = {}; new Function('exports',source)(api)
    window.refreshes=0;window.enabled=true;window.busy=false;window.distance=0
    window.stopPull = api.installPullToRefresh(document.getElementById('root'), {
      enabled:()=>window.enabled,busy:()=>window.busy,progress:value=>window.distance=value,
      refresh:()=>{window.refreshes++;window.busy=true}
    })
  },source)
})
async function touch(page,type,x,y,selector='#target',count=1) {
  await page.evaluate(({type,x,y,selector,count})=>{
    const target=document.querySelector(selector)
    const touches=type==='touchend'||type==='touchcancel'?[]:Array.from({length:count},(_,id)=>new Touch({identifier:id,target,clientX:x+id*5,clientY:y}))
    target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches}))
  },{type,x,y,selector,count})
}
async function pull(page,selector='#target') {
  await touch(page,'touchstart',50,50,selector)
  await touch(page,'touchmove',51,160,selector)
  await touch(page,'touchend',51,160,selector)
}
test('downward pull at the top refreshes once',async({page})=>{
  await touch(page,'touchstart',50,50)
  await touch(page,'touchmove',51,160)
  expect(await page.evaluate(()=>window.distance)).toBe(55)
  await touch(page,'touchend',51,160)
  await pull(page)
  expect(await page.evaluate(()=>window.refreshes)).toBe(1)
  expect(await page.evaluate(()=>window.distance)).toBe(0)
})
test('ordinary scrolling below the top and horizontal gestures do not refresh',async({page})=>{
  await page.evaluate(()=>document.getElementById('scroller').scrollTop=50)
  await pull(page)
  await page.evaluate(()=>document.getElementById('scroller').scrollTop=0)
  await touch(page,'touchstart',50,50);await touch(page,'touchmove',170,80);await touch(page,'touchend',170,180)
  expect(await page.evaluate(()=>window.refreshes)).toBe(0)
})
test('cancelled, reversed and short pulls leave the list unchanged',async({page})=>{
  await touch(page,'touchstart',50,50);await touch(page,'touchmove',51,160);await touch(page,'touchcancel',51,160)
  await touch(page,'touchstart',50,50);await touch(page,'touchmove',51,160);await touch(page,'touchmove',51,52);await touch(page,'touchend',51,52)
  await touch(page,'touchstart',50,50);await touch(page,'touchmove',51,80);await touch(page,'touchend',51,80)
  expect(await page.evaluate(()=>window.refreshes)).toBe(0)
})
test('multi-touch, form fields and disabled surfaces cannot trigger refresh',async({page})=>{
  await touch(page,'touchstart',50,50,'#target',2);await touch(page,'touchmove',51,160,'#target',2);await touch(page,'touchend',51,160)
  await pull(page,'input')
  await page.evaluate(()=>window.enabled=false);await pull(page)
  expect(await page.evaluate(()=>window.refreshes)).toBe(0)
})
test('unmounting removes all gesture listeners',async({page})=>{
  await page.evaluate(()=>window.stopPull());await pull(page)
  expect(await page.evaluate(()=>window.refreshes)).toBe(0)
})

test('real touch input triggers a refresh at the top',async({page})=>{
  const client=await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:60,y:30}]})
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:61,y:145}]})
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expect.poll(()=>page.evaluate(()=>window.refreshes)).toBe(1)
  await client.detach()
})
