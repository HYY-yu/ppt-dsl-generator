import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { applyPalette } from '../src/pptx/data-components.js';
import type { Palette } from '../src/types.js';

// Chart XML snapshots exercise real Office styles; source design binaries are not required.
const fixtures = JSON.parse(await readFile(new URL('../fixtures/template-chart-palettes.json', import.meta.url), 'utf8')) as Record<string, Record<string, string>>;
const parser = new XMLParser({ ignoreAttributes: false });
const palette: Palette = {primary:'#112233',secondary:'#445566',onPrimary:'#FFFFFF',background:'#F8F8F8',surface:'#FFFFFF',text:'#101010',mutedText:'#555555',border:'#CCCCCC',chart:['#AABBCC','#DDEEFF','#123456']};
for (const [template, charts] of Object.entries(fixtures)) {
  test(`${template}: all native charts switch palettes without changing labels/data`, async () => {
    const zip = new JSZip();
    for (const [name, xml] of Object.entries(charts)) zip.file(name, xml);
    for (const colors of [palette.chart, ['#BB1122','#22AA33','#3344BB'], ['#666666','#D4D4D4','#123456']]) {
      await applyPalette(zip, {...palette, chart: colors});
      for (const [name, original] of Object.entries(charts)) {
        const xml = await zip.file(name)!.async('string');
        assert.equal(XMLValidator.validate(xml), true);
        const plot = parser.parse(xml)['c:chartSpace']['c:chart']['c:plotArea'];
        const type = ['barChart','lineChart','pieChart','doughnutChart'].find(t => plot[`c:${t}`])!;
        const rawSeries = plot[`c:${type}`]['c:ser'];
        const series = Array.isArray(rawSeries) ? rawSeries : [rawSeries];
        series.forEach((s: any, index: number) => {
          const style = type === 'lineChart' ? s['c:spPr']['a:ln'] : s['c:spPr'];
          assert.equal(style['a:solidFill']['a:srgbClr']['@_val'], colors[index % colors.length].slice(1));
          if (type === 'pieChart' || type === 'doughnutChart') {
            const points = Array.isArray(s['c:dPt']) ? s['c:dPt'] : [s['c:dPt']];
            const count = s['c:cat']['c:strRef']['c:strCache']['c:ptCount']['@_val'];
            assert.equal(points.length, Number(count));
            points.forEach((point: any) => assert.equal(point['c:spPr']['a:solidFill']['a:srgbClr']['@_val'], colors[Number(point['c:idx']['@_val']) % colors.length].slice(1)));
          }
        });
        for (const tag of ['cat','val','tx','dLbls']) {
          const re = new RegExp(`<c:${tag}\\b[^>]*>[\\s\\S]*?</c:${tag}>`, 'g');
          assert.deepEqual(xml.match(re), original.match(re), `${template} ${name} preserves ${tag}`);
        }
      }
    }
  });
}
test('partial slice overrides are completed before labels and preserve borders', async () => {
  const zip = new JSZip();
  zip.file('ppt/charts/chart1.xml','<c:pieChart><c:ser><c:idx val="0"/><c:order val="0"/><c:dPt><c:idx val="1"/><c:spPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt><c:dLbls><c:showVal val="1"/></c:dLbls><c:cat><c:strRef><c:strCache><c:ptCount val="3"/></c:strCache></c:strRef></c:cat></c:ser></c:pieChart>');
  await applyPalette(zip, palette);
  const xml = await zip.file('ppt/charts/chart1.xml')!.async('string');
  assert.equal((xml.match(/<c:dPt>/g) ?? []).length, 3);
  assert.ok(xml.lastIndexOf('</c:dPt>') < xml.indexOf('<c:dLbls>'));
  assert.match(xml, /<a:srgbClr val="FFFFFF"/);
  assert.doesNotMatch(xml, /lumMod|schemeClr/);
});
