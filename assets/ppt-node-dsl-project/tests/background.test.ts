import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseComponentName} from '../src/dsl/parse.js';
import {sourceSlidePartNumber} from '../src/pptx/generate.js';
import {validateDeckInput} from '../src/validation.js';
import type {TemplateManifest,DeckInput} from '../src/types.js';

test('background has one exact marker and uses physical slide part after reorder',()=>{
 assert.equal(parseComponentName('@背景')?.kind,'background');
 assert.equal(parseComponentName('@背景-1'),undefined);assert.equal(parseComponentName('@背景[1-3]'),undefined);
 assert.equal(sourceSlidePartNumber({slidePath:'ppt/slides/slide21.xml'}),21);
 assert.throws(()=>sourceSlidePartNumber({slidePath:'../slide1.xml'}));
});
test('background paths must be present, raster and shared across the deck',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ppt-background-'));
 try {
  for(const name of ['a.png','b.png','c.svg'])await writeFile(path.join(dir,name),'fixture');
  const manifest={sourceTemplate:'fixture',generatedAt:'',slideCount:2,slides:[1,2].map(i=>({templateId:'s'+i,slideNumber:i,slidePath:`ppt/slides/slide${i}.xml`,pageType:i===1?'封面页':'结尾页',logic:[],warnings:[],lists:[],nodes:[{key:'bg',kind:'background',ordinal:1,rawDsl:'@背景',sampleContent:'',locator:{shapeId:'1',shapeName:'@背景',nodeType:'pic',path:[0]}}]}))} as TemplateManifest;
  const input:DeckInput={slides:[1,2].map(i=>({templateId:'s'+i,nodes:{bg:{path:path.join(dir,'a.png')}}}))};
  const baseline=await validateDeckInput(manifest,input);
  input.slides[1].nodes!.bg={path:path.join(dir,'b.png')};assert.ok((await validateDeckInput(manifest,input)).length>baseline.length);
  input.slides[1].nodes!.bg={path:path.join(dir,'c.svg')};assert.ok((await validateDeckInput(manifest,input)).length>baseline.length);
  delete input.slides[1].nodes!.bg;assert.ok((await validateDeckInput(manifest,input)).length>baseline.length);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('old background copies are removed while shared and master images survive',async()=>{
 const {default:JSZip}=await import('jszip');const {removeUnreferencedMediaParts}=await import('../src/pptx/generate.js');
 const zip=new JSZip();
 for(const n of ['old','shared','master'])zip.file(`ppt/media/${n}.png`,'fixture');
 const rel=(target:string)=>`<Relationships><Relationship Id="rId1" Type="image" Target="${target}"/></Relationships>`;
 zip.file('ppt/slides/_rels/slide1.xml.rels',rel('../media/shared.png'));
 zip.file('ppt/slides/_rels/slide2.xml.rels',rel('../media/shared.png'));
 zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels',rel('../media/master.png'));
 zip.file('[Content_Types].xml','<Types><Override PartName="/ppt/media/old.png" ContentType="image/png"/></Types>');
 assert.equal((await removeUnreferencedMediaParts(zip)).count,1);
 assert.equal(zip.file('ppt/media/old.png'),null);assert.ok(zip.file('ppt/media/shared.png'));assert.ok(zip.file('ppt/media/master.png'));
 assert.doesNotMatch(await zip.file('[Content_Types].xml')!.async('string'),/old.png/);
});
