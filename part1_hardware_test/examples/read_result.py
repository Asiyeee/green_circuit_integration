"""결과 JSON 을 파이썬으로 읽는 예제 (표준 라이브러리만 사용).
실행:  python3 examples/read_result.py            # results/latest.json
       python3 examples/read_result.py sample-result.json
"""
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).parent.parent / "results" / "latest.json"
r = json.loads(path.read_text(encoding="utf-8"))

assert r["schema"] == "device-hw-test/v1", f"지원하지 않는 schema: {r['schema']}"

phone = (r["device"].get("declared") or {})
print("기종:", phone.get("model") or "(선택 안 함)")

for k in ("camera", "microphone", "speaker", "touch", "gyro"):
    print(f"{k:<10}", r["results"][k]["status"])

p = r["results"]["camera"].get("profile")  # 분석 실패하면 None
if p:
    # 점수는 None 일 수 있으니 `or 0` 같은 기본값을 주세요
    print("등급:", p["grade"], "| 빈티지:", p["look"]["vintage_score"], "| 선명도:", p["scores"]["sharpness"])
    print("잘 맞는 용도:", [b["use"] for b in p["best_for"]])
