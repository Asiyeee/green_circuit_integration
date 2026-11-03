(function (root) {
  'use strict';
  function hardwareDetails(k, it = {}) {
    if (k === 'camera') {
      const low = it.lowLight;
      const grade = it.photoGrade || it.profile?.grade;
      return [grade ? `촬영 사진 화질 ${grade}등급 (전체 기기·외관 등급 아님)` : '촬영 사진 화질 미평가', low?.status === 'done' && low.score != null ? `추가 저조도 사진 점수 ${low.score}/10 (${low.scoreSource || '미확인'})` : '저조도 미측정·미완료'].join(' · ');
    }
    if (k === 'microphone') return [it.peakDb != null ? `최대 ${it.peakDb}dB` : '측정값 없음', it.noiseFloorDb != null ? `주변 잡음 ${it.noiseFloorDb}dB` : null, it.quality ? `녹음 품질 ${it.quality.grade || '미확인'} · SNR ${it.quality.snrDb ?? '미확인'}dB${it.quality.noiseGateSuspected ? ' · 노이즈 게이트 의심' : ''}` : '정밀 음질 미측정'].filter(Boolean).join(' · ');
    if (k === 'speaker') {
      const loop = it.loopback;
      return [it.userConfirmed === true ? '사용자 재생음 확인' : it.userConfirmed === false ? '사용자 재생음 미확인' : '사용자 확인 없음', it.countTest ? `횟수 응답 ${it.countTest.answered ?? '?'}/${it.countTest.played ?? '?'} · ${it.countTest.correct ? '일치' : '불일치'}` : '횟수 시험 없음', loop?.status === 'ok' ? `음역대 감지 ${loop.detectedCount}/${loop.total} · ${loop.grade || '미확인'}등급` : `음역대 자동 측정 ${{error:'실패',unsupported:'미지원'}[loop?.status] || '미측정'}`].join(' · ');
    }
    if (k === 'touch') return it.cellsHit != null ? `${it.cellsHit}/${it.cellsTotal ?? '?'}칸 · 동시 ${it.maxSimultaneousTouches ?? '?'}점${it.coveragePct != null ? ' · 도달률 ' + it.coveragePct + '%' : ''}${it.missedEdgeCells != null ? ' · 가장자리 미도달 ' + it.missedEdgeCells + '칸' : ''}` : '터치 측정값 없음';
    return it.maxOrientationRangeDeg != null ? `회전 범위 ${Math.round(it.maxOrientationRangeDeg)}°` : '측정값 없음';
  }
  if (typeof module !== 'undefined') module.exports = { hardwareDetails };
  else root.hardwareDetails = hardwareDetails;
})(globalThis);
