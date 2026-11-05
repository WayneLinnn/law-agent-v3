import assert from "node:assert/strict";

import { intakeFromModelText, intakeNeedsModel, mergeIntake, parseIntake } from "../lib/intake.ts";

const complaint = `民事起诉状

原告：甲建设有限公司，统一社会信用代码91330100MA1234567X
被告：乙置业有限公司、丙贸易有限公司
委托代理人：王律师

案由：建设工程施工合同纠纷

诉讼请求：
判令支付工程款。

事实与理由：
甲公司承包了工程。

此致
杭州市西湖区人民法院
`;

const read = parseIntake(complaint);
assert.deepEqual(
  read.people.map((party) => party.name),
  ["甲建设有限公司", "乙置业有限公司", "丙贸易有限公司"],
);
assert.equal(read.people[0].position, "原告");
assert.equal(read.people[0].idNumber, "91330100MA1234567X");
assert.equal(read.people[1].position, "被告");
assert.equal(read.people[2].position, "被告");
assert.equal(read.people[1].idNumber, "");
assert.deepEqual(read.organs.map((party) => party.name), ["杭州市西湖区人民法院"]);
assert.equal(read.cause, "建设工程施工合同纠纷");
assert.match(read.mandate, /支付工程款/);
assert.match(read.facts, /承包了工程/);
assert.equal("client" in read, false);

const criminal = parseIntake("被告人：张三\n复议机关：杭州市人民政府\n");
assert.deepEqual(criminal.people, [
  { name: "张三", position: "被告人", idNumber: "" },
]);
assert.deepEqual(criminal.organs, [
  { name: "杭州市人民政府", position: "复议机关", idNumber: "" },
]);

const blank = parseIntake("这是一段闲聊，没有当事人。");
assert.deepEqual(blank, {
  people: [],
  organs: [],
  cause: "",
  facts: "",
  mandate: "",
});

assert.equal(intakeNeedsModel(read, complaint), false);
assert.equal(intakeNeedsModel(criminal, "被告人：张三\n复议机关：杭州市人民政府\n"), false);
assert.equal(intakeNeedsModel(blank, "这是一段闲聊，没有当事人。"), false);

const defense = `民事答辩状
答辩人：金正大生态工程集团股份有限公司
被答辩人：徽商银行股份有限公司北京分行
就徽商银行票据利益返还请求权纠纷一案【案号：(2023)鲁13民初195号】，答辩如下：
一、本案基本情况
2018年7月19日，包商银行分别与临沂维伦签署合同，发放贷款1亿元。
从上述基本事实可见，并未受让合法的案涉票据权利。
二、法律意见
包商银行可以行使汇票权利。
综上，请贵院依法驳回原告徽商银行的全部诉讼请求，或驳回其起诉。
此致
临沂市中级人民法院
`;
const defenseRules = parseIntake(defense);
assert.deepEqual(defenseRules.people, []);
assert.deepEqual(
  defenseRules.organs.map((party) => party.name),
  ["临沂市中级人民法院"],
);
assert.equal(intakeNeedsModel(defenseRules, defense), true);

const seen = intakeFromModelText(
  JSON.stringify({
    people: [
      { name: "金正大生态工程集团股份有限公司", position: "答辩人", idNumber: "" },
      { name: "徽商银行股份有限公司北京分行", position: "被答辩人", idNumber: "不是代码" },
      { name: "包商银行", position: "转让人", idNumber: "" },
    ],
    organs: [
      { name: "临沂市中级人民法院", position: "", idNumber: "" },
      { name: "呼和浩特市蒙正公证处", position: "", idNumber: "" },
    ],
    cause: "票据利益返还请求权纠纷",
    mandate: "请贵院依法驳回原告徽商银行的全部诉讼请求，或驳回其起诉。",
    factsStart: "2018年7月19日，包商银行",
    factsEnd: "并未受让合法的案涉票据权利。",
  }),
  defense,
);
assert.ok(seen);
assert.deepEqual(
  seen.people.map((party) => `${party.position}：${party.name}`),
  [
    "答辩人：金正大生态工程集团股份有限公司",
    "被答辩人：徽商银行股份有限公司北京分行",
  ],
);
assert.equal(seen.people[1].idNumber, "");
assert.deepEqual(
  seen.organs.map((party) => party.name),
  ["临沂市中级人民法院"],
);
assert.equal(seen.cause, "票据利益返还请求权纠纷");
assert.equal(seen.mandate, "请贵院依法驳回原告徽商银行的全部诉讼请求，或驳回其起诉。");
assert.match(seen.facts, /^2018年7月19日/);
assert.match(seen.facts, /案涉票据权利。$/);
assert.doesNotMatch(seen.facts, /法律意见/);

const kept = mergeIntake(defenseRules, {
  people: seen.people,
  organs: [],
  cause: seen.cause,
  facts: seen.facts,
  mandate: seen.mandate,
});
assert.deepEqual(
  kept.organs.map((party) => party.name),
  ["临沂市中级人民法院"],
);
assert.equal(intakeFromModelText("不是 JSON", defense), null);

console.log("intake ok");
