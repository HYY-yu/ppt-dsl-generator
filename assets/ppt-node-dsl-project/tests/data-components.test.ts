import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseComponentName } from '../src/dsl/parse.js';
import { parseSlideNodes } from '../src/pptx/nodes.js';
import { inspectDataComponent, validateDataValue, patchDataComponent, applyPalette, validatePalette } from '../src/pptx/data-components.js';
import { buildDeckContentSchema, buildInputSchema } from '../src/schema.js';
import { validateDeckContent } from '../src/validation.js';
import type { ComponentManifest, Palette, TemplateManifest } from '../src/types.js';

const frame = (name: string, body: string) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="11" name="${name}"/></p:nvGraphicFramePr>${body}</p:graphicFrame>`;
const chartXml = '<c:chartSpace><c:barChart><c:ser><c:tx><c:v>old</c:v></c:tx><c:cat><c:strRef><c:strCache><c:ptCount val="3"/></c:strCache></c:strRef></c:cat><c:val><c:numRef/></c:val><c:dPt><c:idx val="2"/></c:dPt></c:ser></c:barChart><c:externalData r:id="rId1"/></c:chartSpace>';
const relation = (target: string) => `<Relationships><Relationship Id="rId1" Target="${target}" Type="http://example.test/relationship"/></Relationships>`;
async function fixture() {
 const zip = new JSZip(), book = new JSZip();
 book.file('xl/workbook.xml','<workbook><sheets><sheet name="Data" r:id="rId1"/></sheets></workbook>');
 book.file('xl/_rels/workbook.xml.rels',relation('worksheets/sheet1.xml'));
 book.file('xl/worksheets/sheet1.xml','<worksheet><dimension ref="A1:B4"/><sheetData><row r="4"/></sheetData></worksheet>');
 zip.file('ppt/embeddings/original.xlsx',await book.generateAsync({type:'nodebuffer'}));
 zip.file('ppt/charts/chart1.xml',chartXml);
 zip.file('ppt/charts/_rels/chart1.xml.rels',relation('../embeddings/original.xlsx'));
 for (const n of [1,2]) zip.file(`ppt/slides/_rels/slide${n}.xml.rels`,relation('../charts/chart1.xml'));
 zip.file('[Content_Types].xml','<Types></Types>');
 const xml=frame('@图表','<c:chart r:id="rId1"/>'), node=parseSlideNodes(xml)[0];
 const c: ComponentManifest={key:'chart_1',kind:'chart',ordinal:1,rawDsl:'@图表',sampleContent:'',locator:{shapeId:'11',shapeName:'@图表',nodeType:'graphicFrame',path:[0]},...await inspectDataComponent(zip,'ppt/slides/slide1.xml',node,'chart')};
 return {zip,xml,node,c};
}

test('native markers parse graphicFrame and reject misleading length/suffix declarations',()=>{
 assert.equal(parseComponentName('@表格')?.kind,'table');
 assert.equal(parseComponentName('@图表')?.kind,'chart');
 assert.equal(parseComponentName('@图表[1-4]'),undefined);
 assert.equal(parseComponentName('@表格-2'),undefined);
 assert.equal(parseSlideNodes(frame('@表格',''))[0].type,'graphicFrame');
});
test('inspect charts rejects unsupported types, external workbooks and missing chart relationship',async()=>{
 const {zip,node,c}=await fixture(); assert.deepEqual(c.chart,{type:'bar',series:1,minCategories:1,maxCategories:3,maxTextLength:24});
 zip.file('ppt/charts/chart1.xml',chartXml.replaceAll('barChart','pieChart'));
 await assert.rejects(inspectDataComponent(zip,'ppt/slides/slide1.xml',node,'chart'),/暂不支持/);
 zip.file('ppt/charts/chart1.xml',chartXml);
 zip.file('ppt/charts/_rels/chart1.xml.rels',relation('https://example.test/data.xlsx').replace('Target=','TargetMode="External" Target='));
 await assert.rejects(inspectDataComponent(zip,'ppt/slides/slide1.xml',node,'chart'),/内部/);
});
test('data validation rejects malformed labels, dimensions and doughnut values',async()=>{
 const {c}=await fixture(); c.chart!.type='doughnut';
 assert.deepEqual(validateDataValue(c,{categories:['甲','乙'],series:[{name:'收入',values:[1,2]}]}),[]);
 for(const v of [null,{categories:['A','A'],series:[{name:'N',values:[1,2]}]},{categories:['A'],series:[{name:'N',values:['1']}]},{categories:['A'],series:[{name:'N',values:[NaN]}]},{categories:['A'],series:[{name:'N',values:[-1]}]},{categories:['A'],series:[{name:'N',values:[0]}]},{categories:['A'],series:[{name:'N',values:[1,2]}]},{categories:['A\u200b'],series:[{name:'N',values:[1]}]},{categories:['A'],series:[{name:'N',values:[1]}],extra:true}]) assert.ok(validateDataValue(c,v).length);
});
test('reused chart pages isolate caches, formulas, workbooks and stale data points',async()=>{
 const {zip,xml,node,c}=await fixture();
 for (const n of [1,2]) await patchDataComponent(zip,`ppt/slides/slide${n}.xml`,xml,node,c,{categories:['甲','乙'],series:[{name:'收入',values:[12,n*34]}]});
 assert.equal(await zip.file('ppt/charts/chart1.xml')!.async('string'),chartXml);
 for(const n of [1,2]) {
  const chart=await zip.file(`ppt/charts/dsl-${n}-11.xml`)!.async('string');
  assert.match(chart,/\$B\$2:\$B\$3/); assert.ok(chart.includes(`<c:v>${n*34}</c:v>`)); assert.doesNotMatch(chart,/<c:dPt>/);
  const book=await JSZip.loadAsync(await zip.file(`ppt/embeddings/dsl-${n}-11.xlsx`)!.async('nodebuffer'));
  const sheet=await book.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.match(sheet,/收入/); assert.match(sheet,/A1:B3/); assert.ok(sheet.includes(`<v>${n*34}</v>`)); assert.doesNotMatch(sheet,/r="4"/);
 }
});
test('table contracts reject merges and preserve blank-cell styles and overall height when shrinking',async()=>{
 const zip=new JSZip();
 const cell='<a:tc><a:txBody><a:p><a:pPr/><a:endParaRPr/></a:p></a:txBody><a:tcPr/></a:tc>';
 const xml=frame('@表格',`<a:tbl><a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid>${[1,2,3].map(()=>`<a:tr h="100">${cell.repeat(2)}</a:tr>`).join('')}</a:tbl>`);
 const node=parseSlideNodes(xml)[0];
 const c:ComponentManifest={key:'table_1',kind:'table',ordinal:1,rawDsl:'@表格',sampleContent:'',locator:{shapeId:'11',shapeName:'@表格',nodeType:'graphicFrame',path:[0]},...await inspectDataComponent(zip,'',node,'table')};
 assert.equal(c.table!.maxRows,2);
 assert.ok(validateDataValue(c,{headers:['A'],rows:[['B']]}).length);
 const out=await patchDataComponent(zip,'ppt/slides/slide1.xml',xml,node,c,{headers:['A','B'],rows:[['甲&乙','丁']]});
 assert.equal([...out.matchAll(/<a:tr\b/g)].length,2); assert.match(out,/<a:tr h="200">/); assert.match(out,/甲&amp;乙/); assert.match(out,/<a:r>[\s\S]*?<a:endParaRPr/); assert.match(out,/<a:tcPr/);
 await assert.rejects(inspectDataComponent(zip,'',{...node,raw:node.raw.replace('<a:tc>','<a:tc gridSpan="2">')},'table'),/合并/);
});
test('content schema and validator accept data but keep deterministic palette out of model output',async()=>{
 const {c}=await fixture();
 const manifest={slides:[{templateId:'data',slideNumber:1,pageType:'内容页',nodes:[c],lists:[]}]} as unknown as TemplateManifest;
 const content=buildDeckContentSchema(manifest) as any, full=buildInputSchema(manifest) as any;
 assert.ok(content.properties.slides.items.anyOf[0].properties.nodes.properties.chart_1);
 assert.equal(content.properties.palette,undefined);assert.ok(full.properties.palette);
 const errors=await validateDeckContent(manifest,{slides:[{templateId:'data',nodes:{chart_1:{categories:['甲'],series:[{name:'收入',values:[1]}]}}}]});
 assert.ok(!errors.some(e=>e.includes('chart_1')));
});
test('palette preserves inverse text independently of background and rejects malformed values',async()=>{
 const zip=new JSZip();zip.file('ppt/slides/slide1.xml','<a:rPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:rPr>');zip.file('ppt/theme/theme1.xml','<a:accent1><a:srgbClr val="000000"/></a:accent1>');
 const p:Palette={primary:'#112233',onPrimary:'#FEFEFE',secondary:'#334455',background:'#F8F5FC',surface:'#FFFFFF',text:'#111111',mutedText:'#555555',border:'#DDDDDD',chart:['#112233','#334455','#556677']};
 await applyPalette(zip,p);assert.match(await zip.file('ppt/slides/slide1.xml')!.async('string'),/FEFEFE/);assert.match(await zip.file('ppt/theme/theme1.xml')!.async('string'),/112233/);
 assert.ok(validatePalette(null as unknown as Palette).length);assert.ok(validatePalette({...p,extra:'x'} as Palette).length);
});
