import { describe, expect, it } from "vitest";
import {
  TEACHER_CSV_HEADER,
  TEACHER_CSV_TEMPLATE_ROWS,
  TeacherQuestionInputSchema,
  csvRecordToInput,
  parseCsv,
  parseTeacherCsv,
  questionToCsvRow,
} from "./teacher-csv";
import { toCsv } from "./csv";

/* ─── parseCsv ─── */

describe("parseCsv", () => {
  it("splits plain rows on commas and newlines", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles CRLF, CR-only and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2\r")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps commas, newlines and doubled quotes inside quoted fields", () => {
    const text = 'q,ans\n"若 $F=ma$，則 a=?","he said ""hi""\nsecond line"\n';
    expect(parseCsv(text)).toEqual([
      ["q", "ans"],
      ["若 $F=ma$，則 a=?", 'he said "hi"\nsecond line'],
    ]);
  });

  it("strips a UTF-8 BOM and skips blank lines", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n   \n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("preserves empty cells", () => {
    expect(parseCsv("a,,c\n,,\n")).toEqual([["a", "", "c"]]);
  });
});

/* ─── TeacherQuestionInputSchema ─── */

const mc = {
  chapter: 4,
  type: "multiple_choice",
  question: "F = ?",
  options: ["ma", "mv", "mg", "mgh"],
  correct_answer: "a",
};

describe("TeacherQuestionInputSchema", () => {
  it("accepts a minimal MC question and normalizes the letter", () => {
    const r = TeacherQuestionInputSchema.safeParse(mc);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.correct_answer).toBe("A");
    expect(r.data.difficulty).toBe("medium");
    expect(r.data.points).toBe(1);
    expect(r.data.tags).toEqual([]);
    expect(r.data.options).toEqual(["ma", "mv", "mg", "mgh"]);
  });

  it("accepts 'B.' / '(c)' style MC answers", () => {
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, correct_answer: "B." }).data?.correct_answer).toBe("B");
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, correct_answer: "(c)" }).data?.correct_answer).toBe("C");
  });

  it("rejects MC with the wrong number of options or a non-letter answer", () => {
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, options: ["a", "b", "c"] }).success).toBe(false);
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, options: ["a", "b", "c", " "] }).success).toBe(false);
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, correct_answer: "E" }).success).toBe(false);
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, correct_answer: "ma" }).success).toBe(false);
  });

  it("forces options to null for short answer", () => {
    const r = TeacherQuestionInputSchema.safeParse({
      chapter: 7, type: "short_answer", question: "v=?", correct_answer: "sqrt(2gh)", options: ["x"],
    });
    expect(r.success).toBe(true);
    expect(r.data?.options).toBeNull();
  });

  it("rejects out-of-range chapters and blank text", () => {
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, chapter: 0 }).success).toBe(false);
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, chapter: 38 }).success).toBe(false);
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, chapter: 2.5 }).success).toBe(false);
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, question: "   " }).success).toBe(false);
    expect(TeacherQuestionInputSchema.safeParse({ ...mc, correct_answer: "" }).success).toBe(false);
  });
});

/* ─── csvRecordToInput ─── */

describe("csvRecordToInput", () => {
  it("maps Chinese aliases for type / difficulty and splits tags on ';'", () => {
    const r = TeacherQuestionInputSchema.safeParse(csvRecordToInput({
      chapter: "12", type: "選擇題", difficulty: "進階", question: "Q",
      optionA: "1", optionB: "2", optionC: "3", optionD: "4", correct_answer: "d",
      tags: "期中; 計算 ;;",
    }));
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ chapter: 12, type: "multiple_choice", difficulty: "hard", correct_answer: "D", tags: ["期中", "計算"] });
  });

  it("treats empty optional cells as defaults", () => {
    const r = TeacherQuestionInputSchema.safeParse(csvRecordToInput({
      chapter: "3", type: "sa", question: "Q", correct_answer: "A long answer", points: "", difficulty: "",
    }));
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ type: "short_answer", difficulty: "medium", points: 1, options: null, explanation: "" });
  });

  it("flags non-numeric chapter / points", () => {
    expect(TeacherQuestionInputSchema.safeParse(csvRecordToInput({ chapter: "ch4", type: "sa", question: "Q", correct_answer: "x" })).success).toBe(false);
    expect(TeacherQuestionInputSchema.safeParse(csvRecordToInput({ chapter: "4", type: "sa", question: "Q", correct_answer: "x", points: "two" })).success).toBe(false);
  });
});

/* ─── parseTeacherCsv ─── */

const HEADER = TEACHER_CSV_HEADER.join(",");

describe("parseTeacherCsv", () => {
  it("round-trips the shipped template", () => {
    const text = toCsv([...TEACHER_CSV_HEADER], TEACHER_CSV_TEMPLATE_ROWS);
    const { rows, errors } = parseTeacherCsv(text);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ chapter: 4, type: "multiple_choice", correct_answer: "B", tags: ["期中", "計算"] });
    expect(rows[1]).toMatchObject({ chapter: 7, type: "short_answer", options: null });
    // Exporting the parsed rows reproduces the same cells.
    const exported = rows.map((r) => questionToCsvRow({ ...r, options: r.options ?? null }));
    expect(exported[0]).toEqual(TEACHER_CSV_TEMPLATE_ROWS[0]);
  });

  it("keeps good rows and reports bad ones with spreadsheet row numbers", () => {
    const text = [
      HEADER,
      "4,multiple_choice,,easy,Q1,a,b,c,d,A,,1,",
      "99,short_answer,,,Q2,,,,,ans,,,",            // bad chapter → row 3
      "5,multiple_choice,,,Q3,a,b,c,,B,,,",         // 3 options   → row 4
      "6,short_answer,,,Q4,,,,,ans4,,2,x;y",
    ].join("\n");
    const { rows, errors } = parseTeacherCsv(text);
    expect(rows.map((r) => r.question)).toEqual(["Q1", "Q4"]);
    expect(errors.map((e) => e.row)).toEqual([3, 4]);
    expect(errors[0].message).toContain("chapter");
    expect(errors[1].message).toContain("選項");
  });

  it("accepts columns in any order and with odd casing", () => {
    const text = "Question,Correct_Answer,TYPE,chapter \nQ,ans,sa,9\n";
    const { rows, errors } = parseTeacherCsv(text);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ chapter: 9, type: "short_answer", question: "Q", correct_answer: "ans" });
  });

  it("fails fast on a header missing required columns", () => {
    const { rows, errors } = parseTeacherCsv("chapter,question\n1,Q\n");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].message).toContain("type");
    expect(errors[0].message).toContain("correct_answer");
  });

  it("reports an empty file", () => {
    expect(parseTeacherCsv("").errors[0].message).toContain("空");
  });
});
