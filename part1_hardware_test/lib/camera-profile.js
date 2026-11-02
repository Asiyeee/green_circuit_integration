'use strict';
// Gemini 가 돌려준 JSON 을 믿지 않고 정리합니다.
// - 허용된 enum 값만 남기고, 점수는 정수 범위로 자르고, 빠진 필드는 null/빈 배열로 채웁니다.
// - enum 목록은 prompts/camera-profile.schema.json 을 단일 출처로 사용합니다.

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '..', 'prompts');

function loadPrompt() {
  return {
    system: fs.readFileSync(path.join(PROMPT_DIR, 'camera-profile.system.md'), 'utf8'),
    schema: JSON.parse(fs.readFileSync(path.join(PROMPT_DIR, 'camera-profile.schema.json'), 'utf8')),
  };
}

function nodeAt(schema, keys) {
  let n = schema;
  for (const k of keys) {
    if (n.type === 'ARRAY') n = n.items;
    n = n.properties[k];
  }
  return n;
}
function enumAt(schema, keys) {
  const n = nodeAt(schema, keys);
  return (n.type === 'ARRAY' ? n.items : n).enum || [];
}

const int = (v, lo, hi) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};
const num = (v, lo, hi) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Number(n.toPrecision(6)) : null;   // 셔터 속도처럼 작은 값도 정확히
};
const pick = (v, list, def = null) => (list.includes(v) ? v : def);
const arrEnum = (a, list, max) =>
  [...new Set((Array.isArray(a) ? a : []).filter((x) => list.includes(x)))].slice(0, max);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v) => v === true;

function normalizeAnalysis(parsed, schema) {
  const src = parsed && typeof parsed === 'object' ? parsed : {};
  const q = src.qa && typeof src.qa === 'object' ? src.qa : {};
  const p = src.profile && typeof src.profile === 'object' ? src.profile : {};
  const sc = p.scores || {};
  const lk = p.look || {};
  const op = p.optics || {};

  const qa = {
    sharpness: int(q.sharpness, 1, 10),
    exposure: pick(q.exposure, enumAt(schema, ['qa', 'exposure'])),
    noise: int(q.noise, 1, 10),
    color_accuracy: int(q.color_accuracy, 1, 10),
    motion_blur: bool(q.motion_blur),
    lens_obstruction: bool(q.lens_obstruction),
    overall_pass: null,
    issues: (Array.isArray(q.issues) ? q.issues : []).map((s) => str(s, 60)).filter(Boolean).slice(0, 6),
    summary_ko: str(q.summary_ko, 300),
  };
  // 모델이 overall_pass 를 빼먹으면 규칙으로 계산
  qa.overall_pass = typeof q.overall_pass === 'boolean'
    ? q.overall_pass
    : !(qa.lens_obstruction || (qa.sharpness !== null && qa.sharpness <= 3));

  let defects = arrEnum(p.defects, enumAt(schema, ['profile', 'defects']), 6);
  if (defects.length > 1) defects = defects.filter((d) => d !== 'none');
  if (defects.length === 0) defects = ['none'];

  const useList = enumAt(schema, ['profile', 'best_for', 'use']);
  const bestFor = (Array.isArray(p.best_for) ? p.best_for : [])
    .filter((b) => b && useList.includes(b.use))
    .map((b) => ({ use: b.use, reason_ko: str(b.reason_ko, 200) }))
    .slice(0, 3);

  const profile = {
    grade: pick(p.grade, enumAt(schema, ['profile', 'grade'])),
    summary_ko: str(p.summary_ko, 500),
    scores: {
      sharpness: int(sc.sharpness, 1, 10),
      noise_cleanliness: int(sc.noise_cleanliness, 1, 10),
      dynamic_range: int(sc.dynamic_range, 1, 10),
      exposure_accuracy: int(sc.exposure_accuracy, 1, 10),
      color_accuracy: int(sc.color_accuracy, 1, 10),
      low_light_potential: int(sc.low_light_potential, 1, 10),
    },
    look: {
      style_tags: arrEnum(lk.style_tags, enumAt(schema, ['profile', 'look', 'style_tags']), 4),
      vintage_score: int(lk.vintage_score, 1, 10),
      warmth: int(lk.warmth, -5, 5),
      saturation: int(lk.saturation, 1, 10),
      contrast: int(lk.contrast, 1, 10),
      grain: pick(lk.grain, enumAt(schema, ['profile', 'look', 'grain'])),
      softness: pick(lk.softness, enumAt(schema, ['profile', 'look', 'softness'])),
      vignetting: pick(lk.vignetting, enumAt(schema, ['profile', 'look', 'vignetting'])),
      feel_ko: str(lk.feel_ko, 200),
    },
    optics: {
      focal_length_35mm_equiv: num(op.focal_length_35mm_equiv, 1, 2000),
      aperture_f: num(op.aperture_f, 0.7, 64),
      iso: num(op.iso, 25, 409600),
      shutter_s: num(op.shutter_s, 0.00001, 120),
      lens_label: typeof op.lens_label === 'string' && op.lens_label.trim() ? str(op.lens_label, 80) : null,
      depth_of_field: pick(op.depth_of_field, enumAt(schema, ['profile', 'optics', 'depth_of_field']), 'unknown'),
    },
    defects,
    best_for: bestFor,
    not_ideal_for: arrEnum(p.not_ideal_for, useList, 3),
    confidence: pick(p.confidence, enumAt(schema, ['profile', 'confidence']), 'low'),
    caveats_ko: (Array.isArray(p.caveats_ko) ? p.caveats_ko : []).map((s) => str(s, 200)).filter(Boolean).slice(0, 5),
  };

  return { qa, profile };
}

// 모델 출력과 "확실한 정보"(EXIF, 로컬 지표, 사용자가 고른 기종)를 대조하고 고칩니다.
// - optics 수치는 EXIF 가 있을 때만 EXIF 값으로 채우고, 없으면 null (모델이 지어낸 값 제거)
// - 서로 어긋나면 checks.warnings 에 남기고 confidence 를 low 로 내립니다.
function applyChecks(metadata, qa, profile) {
  const md = metadata && typeof metadata === 'object' ? metadata : {};
  const exif = md.exif && typeof md.exif === 'object' ? md.exif : null;
  const local = md.local_metrics && typeof md.local_metrics === 'object' ? md.local_metrics : null;
  const decl = md.user_declared_device && typeof md.user_declared_device === 'object' ? md.user_declared_device : null;
  const ua = String((md.device && md.device.userAgent) || '');
  const warnings = [];

  const o = profile.optics;
  const exifNum = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Number(v.toPrecision(6)) : null);
  if (exif) {
    o.focal_length_35mm_equiv = exifNum(exif.focal_length_35mm_equiv, 1, 2000);
    o.aperture_f = exifNum(exif.f_number, 0.7, 64);
    o.iso = exifNum(exif.iso, 25, 409600);
    o.shutter_s = exifNum(exif.exposure_time_s, 0.00001, 120);
    if (!o.lens_label && typeof exif.lens_model === 'string') o.lens_label = exif.lens_model.slice(0, 80);
  } else {
    o.focal_length_35mm_equiv = null; o.aperture_f = null; o.iso = null; o.shutter_s = null;
  }

  let exposureConsistent = null;
  if (local && typeof local.meanBrightness === 'number' && qa.exposure) {
    exposureConsistent = !((local.meanBrightness < 70 && qa.exposure === 'overexposed') || (local.meanBrightness > 190 && qa.exposure === 'underexposed'));
    if (!exposureConsistent) warnings.push('Gemini 의 노출 판정이 측정한 평균 밝기와 어긋납니다');
  }
  let sharpnessConsistent = null;
  if (local && typeof local.laplacianVariance === 'number' && qa.sharpness !== null) {
    sharpnessConsistent = !(local.laplacianVariance < 30 && qa.sharpness >= 8);
    if (!sharpnessConsistent) warnings.push('Gemini 는 매우 선명하다고 했지만 측정한 선명도 지표는 매우 낮습니다');
  }

  let declaredMatchesUa = null;
  if (decl && decl.model) {
    const isApple = /iPhone|iPad/.test(ua), isAndroid = /Android/.test(ua);
    const brandIsApple = decl.brand === 'Apple' || /^iPhone/i.test(String(decl.model));
    if (isApple) declaredMatchesUa = brandIsApple;
    else if (isAndroid) declaredMatchesUa = !brandIsApple;
    if (declaredMatchesUa === false) warnings.push('사용자가 고른 기종과 접속한 기기(User-Agent)가 다릅니다');
  }

  if (warnings.length) {
    profile.confidence = 'low';
    profile.caveats_ko = [...warnings, ...profile.caveats_ko].slice(0, 5);
  } else if (!exif && profile.confidence === 'high') {
    profile.confidence = 'medium';
  }

  return {
    exif_present: !!exif,
    optics_source: exif ? 'exif' : 'none',
    declared_device_given: !!(decl && decl.model),
    declared_matches_user_agent: declaredMatchesUa,
    exposure_consistent_with_local: exposureConsistent,
    sharpness_consistent_with_local: sharpnessConsistent,
    warnings,
  };
}

module.exports = { loadPrompt, normalizeAnalysis, applyChecks, enumAt };
