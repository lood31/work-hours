import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Diff } from "../components/export-panel";
import type { ExportDiff } from "../lib/services/exports";
const empty: ExportDiff = {
  added: [],
  modified: [],
  removed: [],
  removalReasons: {},
  returned: [],
};
it("版本差异三个空栏目分别明确显示无", () => {
  const html = renderToStaticMarkup(<Diff diff={empty} />);
  expect(html).toMatch(/<h3>新增<\/h3><p[^>]*>无<\/p>/);
  expect(html).toMatch(/<h3>修改<\/h3><p[^>]*>无<\/p>/);
  expect(html).toMatch(/<h3>移出本版<\/h3><p[^>]*>无<\/p>/);
});
it("存在重新进入范围的补充说明时，空修改和移出仍显示无", () => {
  const record = {
    id: "record",
    name: "沈知遥",
    student_no: "0000001001",
    content: "示例稿件",
    hours_units: 80000,
    confirmed_hours_units: 80000,
    remark: "",
  } as ExportDiff["added"][number];
  const diff: ExportDiff = {
    ...empty,
    added: [record],
    returned: [{ previous: record, current: record, version: 1 }],
  };
  const html = renderToStaticMarkup(<Diff diff={diff} />);
  expect(html).toContain("示例稿件");
  expect(html).toContain("重新进入范围");
  expect(html.match(/>无<\/p>/g)).toHaveLength(2);
});
