import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import {analyzeTemplate} from '../src/pptx/analyze.js';
const tx=(id:number,name:string,width:number,text:string)=>`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="127000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const group=(id:number,name:string,content:string)=>`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="1270000"/></a:xfrm></p:grpSpPr>${content}</p:grpSp>`;
function fixture(fixed=false){
 const zip=new JSZip();
 zip.file('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>');
 zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
 const long='这是一个用于合同匹配的长描述字段，保留完整内容。';
 zip.file('ppt/slides/slide1.xml',`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${group(2,fixed?'@1@1':'@1@1[1-3]',tx(3,'@文本[1-10]',127000,'短文')+tx(4,'@文本[20-40]',1270000,long))}${group(5,'@1@2',tx(7,'@文本',1270000,long)+tx(6,'@文本',127000,'短文'))}</p:spTree></p:cSld></p:sld>`);
 return zip;
}
test('compiler aligns same-kind fields with reversed XML order in a self-contained fixture',async()=>{
 const manifest=await analyzeTemplate(fixture(),'synthetic-test.pptx'),list=manifest.slides[0].lists[0];
 assert.equal(list.items[1].components.find(c=>c.key==='text_1')?.locator.shapeId,'6');
 assert.equal(list.items[1].components.find(c=>c.key==='text_2')?.locator.shapeId,'7');
 assert.deepEqual(list.items[1].components.map(c=>c.length),[{min:1,max:10,fixed:false},{min:20,max:40,fixed:false}]);
});
test('fixed groups retain compiler count endpoints even without an explicit range',async()=>{
 const list=(await analyzeTemplate(fixture(true),'synthetic-test.pptx')).slides[0].lists[0];
 assert.equal(list.dynamic,true);assert.equal(list.minItems,2);assert.equal(list.maxItems,2);
});

test('compiler preserves the default matching behavior and enforces a caller-supplied limit', async () => {
  const manifest = await analyzeTemplate(fixture(), 'synthetic-test.pptx');
  assert.equal(manifest.slides[0].lists[0].items[1].components.length, 2);
  await assert.rejects(
    analyzeTemplate(fixture(), 'synthetic-test.pptx', { maxSameKindComponents: 1 }),
    /COMPONENT_MATCH_LIMIT/,
  );
});

test('caller can prefer a named notes object while the default reads all notes', async () => {
  const zip = fixture();
  zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>');
  const notes = (objects: string) => `<p:notes><p:cSld><p:spTree>${objects}</p:spTree></p:cSld></p:notes>`;
  const named = tx(2, 'named-contract', 127000, '封面');
  const speaker = tx(3, 'speaker-notes', 127000, '内容');
  const notesPath = 'ppt/notesSlides/notesSlide1.xml';
  zip.file(notesPath, notes(named + speaker));
  const role = async (notesShapeName?: string) =>
    (await analyzeTemplate(zip, 'synthetic-test.pptx', { notesShapeName })).slides[0].pageType;
  assert.equal(await role(), '内容页');
  assert.equal(await role('absent'), '内容页');
  assert.equal(await role('named-contract'), '封面页');

  zip.file(notesPath, notes(named + speaker + tx(4, 'named-contract', 127000, '目录')));
  await assert.rejects(role('named-contract'), /PAGE_CONTRACT_DUPLICATE/);
});
