import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, type Page } from 'playwright';
import { startServer } from './testMobilePlaywright';
const output = path.join(process.cwd(), 'qa-artifacts/mobile-complete-20260906');
const contact = {id:'conv-mob-1',name:'Distribuidora Sergio Fernández y Hermanos del Mercado Central',publicName:'Sergio Fernández',phone:'5493512345678',pipelineStatus:'follow_up',consentStatus:'opted_in',botPaused:false,labels:['mayorista','seguimiento comercial prioritario'],notes:'Cliente habitual',lastMessageAt:new Date().toISOString(),lastIncomingAt:new Date().toISOString(),inquiryTypes:['horarios','direccion','lista_precio','hacer_pedido','asesor','preguntas_frecuentes','no_reconocidas']};
const orders = [{id:12345,contactId:contact.id,customerName:contact.name,phone:contact.phone,status:'pending_customer',grandTotal:1234567.89,createdAt:contact.lastMessageAt,detail:'12 cajas de queso cremoso, 5 hormas de queso azul y 24 paquetes de fiambre. Entregar por la puerta lateral del depósito.',items:Array.from({length:5},(_,i)=>({name:`Queso cremoso especial de primera calidad presentación familiar ${i}`,quantity:12,price:45000}))}];
async function navigate(page:Page,name:string) {
  const target=page.getByRole('button',{name,exact:true});
  if (!await target.isVisible()) await page.getByRole('button',{name:'Más secciones',exact:true}).click();
  await target.click();
}
async function inspect(page:Page,key:string) {
  await page.screenshot({path:path.join(output,key+'.png'), animations:'disabled'});
  const defects=await page.evaluate(()=>{
    const selectors=['.main-view','.view-toolbar','.toolbar-filters','.modal-sheet','.drawer-head','.drawer-body','.composer','.chat-head','.template-card-modern','.analytics-section-card','.dashboard-layout'];
    return selectors.flatMap(selector=>[...document.querySelectorAll<HTMLElement>(selector)].filter(el=>el.getClientRects().length&&el.scrollWidth>el.clientWidth+2).map(el=>({selector,width:el.clientWidth,scroll:el.scrollWidth})));
  });
  assert.deepEqual(defects,[],key+' internal overflow');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), key+' page overflow');
}
async function fits(page:Page,selector:string) {
  const el=page.locator(selector).first();await el.scrollIntoViewIfNeeded();
  const r=await el.boundingBox();const v=page.viewportSize()!;
  assert.ok(r&&r.x>=-1&&r.x+r.width<=v.width+1&&r.y>=-1&&r.y+r.height<=v.height+1,selector+' unreachable');
}
async function fixture(page:Page) {
  await page.route('**/api/contacts?*',r=>r.fulfill({json:{items:[contact],total:1,page:0,limit:25}}));
  await page.route('**/api/orders?*',r=>r.fulfill({json:{items:orders,total:1}}));
  await page.route('**/api/templates',r=>r.fulfill({json:{items:[{id:'template',metaName:'confirmacion_de_pedido_y_entrega_distribuidora_mayorista',language:'es_AR',category:'UTILITY',status:'APPROVED',body:'Hola {{1}}, confirmamos su pedido. Puede consultar el detalle y coordinar la entrega con nuestro equipo comercial.'}]}}));
  await page.route('**/api/tickets?*',r=>r.fulfill({json:{items:[{id:'ticket',contactId:contact.id,contactName:contact.name,phone:contact.phone,ticketType:'question',displayStatus:'open',question:orders[0].detail,updatedAt:contact.lastMessageAt}],total:1}}));
  await page.route('**/api/conversations/conv-mob-1',r=>r.fulfill({json:{contact,tickets:[],messageCount:10}}));
  await page.route('**/api/analytics?*',async r=>{
    const base=await (await r.fetch()).json();
    const is7d=false, is90d=false, isCustom=false, lastRequestedPeriod='30d', lastRequestedFrom='', lastRequestedTo='', totalUniqueContacts=142;
    const topPatterns=[{text:orders[0].detail,normalizedText:'consulta',count:12,uniqueContacts:10,lastSeenAt:contact.lastMessageAt}];
    const recentUnrecognizedItems=[{id:'unrec',contactId:contact.id,contactName:contact.name,phone:contact.phone,rawText:orders[0].detail,messageType:'text',createdAt:contact.lastMessageAt}];
    const contactsWithoutMenuItems=[{...contact,messageCount:5,botResponseCount:0,responseStatus:'unanswered'}];
    const data={
        period: {
          key: lastRequestedPeriod,
          from: lastRequestedFrom || (is7d ? '2026-08-14T00:00:00.000Z' : '2026-07-22T00:00:00.000Z'),
          to: lastRequestedTo || '2026-08-21T18:00:00.000Z',
          label: is7d ? 'Últimos 7 días' : is90d ? 'Últimos 90 días' : isCustom ? 'Rango personalizado' : 'Últimos 30 días',
        },
        summary: {
          totalUniqueContacts,
          totalNewContacts: is7d ? 23 : 35,
          totalReturningContacts: is7d ? 16 : 29,
          totalIncomingMessages: is7d ? 110 : 380,
          totalMenuInteractions: is7d ? 85 : 295,
          totalMenuOptionsRecognized: is7d ? 72 : 260,
          totalUnrecognizedMessages: is7d ? 12 : 45,
          totalOrdersStarted: is7d ? 18 : 68,
          totalOrdersSubmitted: is7d ? 14 : 52,
          totalAdvisorRequests: is7d ? 9 : 34,
          contactsWithoutMenuCount: is7d ? 5 : 18,
          contactsWithoutBotResponseCount: is7d ? 3 : 10,
          menuOptionRate: is7d ? 65.5 : 68.4,
          unrecognizedRate: is7d ? 10.9 : 11.8,
        },
        menuOptions: [
          { id: 'horarios', label: 'Horarios', number: '1', count: is7d ? 15 : 54, uniqueContacts: is7d ? 12 : 44, percentage: 20.8 },
          { id: 'direccion', label: 'Dirección', number: '2', count: is7d ? 10 : 42, uniqueContacts: is7d ? 9 : 36, percentage: 16.2 },
          { id: 'lista_precio', label: 'Precios', number: '3', count: is7d ? 18 : 60, uniqueContacts: is7d ? 15 : 51, percentage: 23.1 },
          { id: 'hacer_pedido', label: 'Nuevo Pedido', number: '4', count: is7d ? 18 : 68, uniqueContacts: is7d ? 14 : 52, percentage: 26.2 },
          { id: 'asesor', label: 'Asesor Humano', number: '5', count: is7d ? 7 : 22, uniqueContacts: is7d ? 6 : 20, percentage: 8.5 },
          { id: 'preguntas_frecuentes', label: 'Preguntas frecuentes', number: '6', count: is7d ? 4 : 14, uniqueContacts: is7d ? 4 : 12, percentage: 5.4 },
        ],
        trend: [
          { date: '2026-08-19', incomingMessages: 25, menuInteractions: 20, menuRequested: 2, optionsRecognized: 18, unrecognized: 3, uniqueContacts: 15 },
          { date: '2026-08-20', incomingMessages: 30, menuInteractions: 24, menuRequested: 2, optionsRecognized: 22, unrecognized: 4, uniqueContacts: 18 },
          { date: '2026-08-21', incomingMessages: 20, menuInteractions: 16, menuRequested: 1, optionsRecognized: 15, unrecognized: 2, uniqueContacts: 12 },
        ],
        newContactsByDay: [
          { date: '2026-08-19', newContacts: is7d ? 8 : 12 },
          { date: '2026-08-20', newContacts: is7d ? 10 : 15 },
          { date: '2026-08-21', newContacts: is7d ? 5 : 8 },
        ],
        returningContactsByDay: [
          { date: '2026-08-19', returningContacts: is7d ? 4 : 9 },
          { date: '2026-08-20', returningContacts: is7d ? 7 : 11 },
          { date: '2026-08-21', returningContacts: is7d ? 5 : 9 },
        ],
        unrecognizedMessages: {
          total: is7d ? 12 : 45,
          uniqueContacts: is7d ? 10 : 38,
          topPatterns,
          items: recentUnrecognizedItems,
        },
        contactsWithoutMenu: {
          total: is7d ? 5 : 18,
          withoutBotResponse: is7d ? 3 : 10,
          items: contactsWithoutMenuItems,
        },
        coverage: {
          hasTrackingData: true,
          earliestEventAt: '2026-08-01T00:00:00.000Z',
          totalEventsTracked: is7d ? 120 : 420,
          note: 'Métricas generadas a partir de eventos persistidos en el pipeline del worker. No contiene datos simulados ni mockeados.',
        },
      }
    await r.fulfill({json:{...base,...data}});
  });
}
(async()=>{
fs.mkdirSync(output,{recursive:true});const server=await startServer();const port=(server.address() as {port:number}).port;const results:any[]=[];
try {
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]] as const){
 const browser=await type.launch({headless:true});
 try{for(const [width,height] of [[320,568],[390,844],[430,932],[768,1024],[844,390],[1440,900]])for(const theme of ['light','dark'] as const){
 const key=`${engine}-${width}-${theme}`;const context=await browser.newContext({viewport:{width,height},hasTouch:width<1024,colorScheme:theme});await context.addInitScript(t=>localStorage.setItem('abasto-theme',t),theme);const page=await context.newPage();page.setDefaultTimeout(6000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await fixture(page);await page.goto(`http://127.0.0.1:${port}`);await page.locator('.conv-row').first().waitFor();await inspect(page,key+'-inbox');
 for(const name of ['Contactos','Tickets','Pedidos','Plantillas','Resumen','Analíticas']){
 await navigate(page,name);
 await page.locator(name==='Resumen'?'.dashboard-hero':name==='Analíticas'?'.analytics-header-card':name==='Plantillas'?'.template-card-modern':'.interactive-row').first().waitFor();
 await inspect(page,key+'-'+name);
 if(name==='Contactos'){
 await fits(page,'.contact-table-grid button[title="Abrir chat"]');
 if(width<=768)assert.ok(await page.locator('.contact-table-grid').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.getByRole('button',{name:'Nuevo Contacto',exact:true}).click();await inspect(page,key+'-create');await fits(page,'#contact-phone');await page.getByLabel('Número de WhatsApp (con código de país)',{exact:true}).fill('5491100000000');await page.getByRole('button',{name:'Guardar y Abrir',exact:true}).scrollIntoViewIfNeeded();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 }
 if(name==='Pedidos'){
 await page.getByRole('button',{name:'Ver orden',exact:true}).click();await inspect(page,key+'-order');await page.getByRole('button',{name:'Entendido, cerrar',exact:true}).scrollIntoViewIfNeeded();await fits(page,'.sheet-close-btn');await page.getByRole('button',{name:'Cerrar detalle',exact:true}).click();
 }
 if(name==='Analíticas'){
 const tableButton=page.getByRole('button',{name:'Tabla',exact:true});if(await tableButton.isVisible())await tableButton.click();
 await page.locator('.table-responsive-patterns').scrollIntoViewIfNeeded();await inspect(page,key+'-patterns');
 }
 }
 await navigate(page,'Conversaciones');await page.locator('.conv-row').first().click();await page.locator('.composer textarea').waitFor();await inspect(page,key+'-chat');await fits(page,'.composer textarea');
 const controls=page.locator('.chat-controls-toggle');if(await controls.isVisible())await controls.click();await page.getByRole('button',{name:'Ver ficha comercial',exact:true}).click();await inspect(page,key+'-drawer');await fits(page,'.drawer-head .close-btn');await page.getByRole('button',{name:'Guardar ficha',exact:true}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Cerrar ficha',exact:true}).click();
 if(await controls.isVisible()&&await controls.getAttribute('aria-expanded')==='true')await controls.click();
 await page.locator('.composer textarea').fill('Prueba de interfaz local');await page.getByRole('button',{name:'Emojis',exact:true}).click();await fits(page,'.emoji-popup');await page.getByRole('button',{name:'👍',exact:true}).click();assert.match(await page.locator('.composer textarea').inputValue(),/👍/);
 if(width===390){
 await page.locator('.composer textarea').focus();
 await page.evaluate(()=>{const v=window.visualViewport!; Object.defineProperty(v,'height',{configurable:true,value:innerHeight-300}); v.dispatchEvent(new Event('resize'));});
 assert.ok(await page.locator('body').evaluate(el=>el.classList.contains('keyboard-open')));
 const composer=await page.locator('.composer').boundingBox();assert.ok(composer&&composer.y+composer.height<=height-300+1,'Composer covered by simulated keyboard');
 assert.equal(await page.locator('.sidebar').isVisible(),false);
 await inspect(page,key+'-keyboard');
 await page.evaluate(()=>{delete (window.visualViewport as any).height;window.visualViewport!.dispatchEvent(new Event('resize'));});
 }
 assert.deepEqual(errors,[]);results.push({key,passed:true});console.log('PASS',key);
 }catch(e){await page.screenshot({path:path.join(output,key+'-failure.png')});results.push({key,passed:false,error:String(e),errors});console.error('FAIL',key,String(e));}finally{await context.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));}
 }}finally{await browser.close();}}
 assert.ok(results.every(r=>r.passed),'See mobile-complete results.json');
}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
})().catch(e=>{console.error(e);process.exitCode=1;});
