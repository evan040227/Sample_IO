import json
import io
import numpy as np
import openpyxl

book = None
codes = []
names = []
L = M = V = ad = am = None
sheets = []
valid = False
employment_coeff = None

# 산업연관표에는 AI 전용 산업이 별도로 분리되어 있지 않아 관련 산업을 대리변수로 사용합니다.
AI_GROUPS = {
    "semiconductor": {"label": "AI 반도체(집적회로 대리)", "codes": ["3102"]},
    "software": {"label": "AI 소프트웨어(소프트웨어 개발 공급 대리)", "codes": ["6212"]},
    "datacenter": {"label": "AI 데이터센터(호스팅 포함 기타 IT서비스 대리)", "codes": ["6290"]},
}

def emit(x):
    return json.dumps(x, ensure_ascii=False, allow_nan=False)

def initialize(raw):
    global book, codes, names, L, M, V, ad, am, sheets, valid, employment_coeff
    wb = openpyxl.load_workbook(io.BytesIO(bytes(raw)), read_only=True, data_only=True)
    # 기존 코드와 같이 시트 데이터를 메모리로 읽어 둔 뒤 워크북을 닫습니다.
    book = {s: list(wb[s].values) for s in wb.sheetnames}
    sheets = list(book.keys())
    wb.close()

    base = book["국산투입계수(Ad)"]
    codes = [str(c).strip() for c in base[4][2:] if c is not None and str(c).strip().isdigit() and int(str(c).strip()) < 9000]
    if len(codes) != 380 or len(set(codes)) != len(codes):
        raise ValueError("이 버전은 검증된 380개 기본부문 엑셀 구조만 지원합니다.")
    nm = {str(r[0]).strip(): str(r[1]).strip() for r in base[6:] if r[0] is not None and r[1] is not None}
    names = [nm[c] for c in codes]

    def matrix(sheet_name):
        rows = book[sheet_name]
        ri = {str(r[0]).strip(): i for i, r in enumerate(rows) if r and r[0] is not None}
        ci = {str(c).strip(): i for i, c in enumerate(rows[4]) if c is not None}
        a = np.array([[rows[ri[c]][ci[k]] for k in codes] for c in codes], dtype=float)
        if not np.isfinite(a).all():
            raise ValueError(sheet_name + ": 비수치 또는 결측 데이터")
        return a

    L = matrix("생산유발계수")
    M = matrix("수입유발계수")
    V = matrix("부가가치유발계수")
    ad = matrix("국산투입계수(Ad)")
    am = matrix("수입투입계수(Am)")

    total_rows = book["총투입계수(A)"]
    total_ci = {str(c).strip(): i for i, c in enumerate(total_rows[4]) if c is not None}
    value_added_row = next(r for r in total_rows if r and str(r[0]).strip() == "9690")
    value_added_coeff = np.array([value_added_row[total_ci[c]] for c in codes], dtype=float)

    n = len(codes)
    identity = np.eye(n)
    residuals = {
        "생산": float(np.max(np.abs(identity - (identity - ad) @ L))),
        "수입": float(np.max(np.abs(am @ L - M))),
        "부가가치": float(np.max(np.abs(value_added_coeff[:, None] * L - V)))
    }
    valid = max(residuals.values()) < 1e-8
    if not valid:
        raise ValueError("계수 검증 실패: " + str(residuals))

    employment_coeff = None
    return emit({
        "sectors": [{"code": c, "name": n} for c, n in zip(codes, names)],
        "sheets": sheets,
        "residuals": residuals,
        "aiGroups": {
            key: {"label": val["label"], "sectors": [
                {"code": c, "name": names[codes.index(c)]} for c in val["codes"] if c in codes
            ]}
            for key, val in AI_GROUPS.items()
        }
    })

def explore(sheet, rowcode):
    rows = book[sheet]
    choices = [{"code": str(r[0]), "name": str(r[1])} for r in rows[6:] if len(r) > 1 and r[0] is not None and r[1] is not None]
    chosen = next((r for r in rows[6:] if str(r[0]) == str(rowcode)), None)
    if chosen is None:
        chosen = next((r for r in rows[6:] if r[0] is not None and r[1] is not None), None)
    if chosen is None:
        raise ValueError("선택할 수 있는 행이 없습니다.")
    cells = []
    for i in range(2, len(rows[4])):
        if rows[4][i] is None:
            continue
        val = chosen[i] if i < len(chosen) else None
        if isinstance(val, (float, int)):
            val = float(val)
        elif val is not None:
            val = str(val)
        cells.append({"code": str(rows[4][i]), "name": str(rows[5][i] or ""), "value": val})
    unit = str(rows[3][0] or "백만원").replace("단위 :", "").strip()
    return emit({"rows": choices, "selected": str(chosen[0]), "name": str(chosen[1]), "unit": unit, "cells": cells})

def _scenario_vector(shocks):
    f = np.zeros(len(codes), dtype=float)
    for item in shocks:
        code = str(item["code"])
        amount = float(item["amount"])
        if code not in codes:
            raise ValueError("알 수 없는 산업코드: " + code)
        if not np.isfinite(amount) or amount <= 0:
            raise ValueError("수요 증가액은 유한한 양수여야 합니다.")
        f[codes.index(code)] += amount
    if f.sum() <= 0:
        raise ValueError("한 산업 이상의 양의 수요 증가액을 입력하세요.")
    return f

def _make_rows(f):
    x = L @ f
    m = M @ f
    v = V @ f
    e = employment_coeff * x / 1000.0 if employment_coeff is not None else None
    rows = []
    for i, (code, name) in enumerate(zip(codes, names)):
        item = {"code": code, "name": name, "production": float(x[i]), "imports": float(m[i]), "valueAdded": float(v[i])}
        if e is not None:
            item["employment"] = float(e[i])
        rows.append(item)
    rows.sort(key=lambda r: r["production"], reverse=True)
    return x, m, v, e, rows

def simulate(payload):
    if not valid:
        raise ValueError("검증된 데이터가 없습니다.")
    shocks = json.loads(payload) if isinstance(payload, str) else payload
    f = _scenario_vector(shocks)
    x, m, v, e, rows = _make_rows(f)
    result = {"demand": float(f.sum()), "production": float(x.sum()), "imports": float(m.sum()),
              "valueAdded": float(v.sum()), "multiplier": float(x.sum() / f.sum()), "rows": rows}
    if e is not None:
        result["employment"] = float(e.sum())
    return emit(result)

def set_employment(payload):
    global employment_coeff
    if not valid:
        raise ValueError("먼저 기본 엑셀 자료를 불러오세요.")
    items = json.loads(payload) if isinstance(payload, str) else payload
    mapping = {}
    for item in items:
        code = str(item.get("code", "")).strip()
        if code not in codes:
            raise ValueError("취업계수 파일에 알 수 없는 산업코드가 있습니다: " + code)
        raw_value = item.get("coefficient")
        if raw_value is None or str(raw_value).strip() == "":
            raise ValueError("취업계수에 빈 값이 있습니다: " + code)
        value = float(raw_value)
        if not np.isfinite(value) or value < 0:
            raise ValueError("취업계수는 0 이상의 유한한 숫자여야 합니다.")
        mapping[code] = value
    missing = [c for c in codes if c not in mapping]
    if missing:
        raise ValueError("취업계수가 없는 산업코드가 " + str(len(missing)) + "개 있습니다. 380개 부문 모두 입력해야 합니다.")
    if len(mapping) != len(codes):
        raise ValueError("산업코드가 중복되었거나 개수가 맞지 않습니다.")
    employment_coeff = np.array([mapping[c] for c in codes], dtype=float)
    return emit({"loaded": True, "count": len(mapping), "unit": "명/10억원"})

def ai_analyze(payload):
    if not valid:
        raise ValueError("검증된 데이터가 없습니다.")
    p = json.loads(payload) if isinstance(payload, str) else payload
    total = 0.0
    f_total = np.zeros(len(codes), dtype=float)
    group_results = []
    for key in ["semiconductor", "software", "datacenter"]:
        amount = float(p.get(key, 0))
        if not np.isfinite(amount) or amount < 0:
            raise ValueError("AI 산업군별 수요는 0 이상의 유한한 숫자여야 합니다.")
        group = AI_GROUPS[key]
        available = [c for c in group["codes"] if c in codes]
        if not available and amount > 0:
            raise ValueError(group["label"] + "에 해당하는 산업코드를 찾지 못했습니다.")
        fg = np.zeros(len(codes), dtype=float)
        if amount > 0:
            for code in available:
                fg[codes.index(code)] += amount / len(available)
        f_total += fg
        total += amount
        gx, gm, gv, ge, _ = _make_rows(fg)
        group_item = {"key": key, "label": group["label"],
                      "codes": [{"code": c, "name": names[codes.index(c)]} for c in available],
                      "demand": amount, "production": float(gx.sum()),
                      "imports": float(gm.sum()), "valueAdded": float(gv.sum())}
        if ge is not None:
            group_item["employment"] = float(ge.sum())
        group_results.append(group_item)

    if total <= 0:
        raise ValueError("AI 산업군 중 하나 이상에 양의 수요 증가액을 입력하세요.")
    x, m, v, e, rows = _make_rows(f_total)
    result = {"demand": float(total), "production": float(x.sum()), "imports": float(m.sum()),
              "valueAdded": float(v.sum()), "multiplier": float(x.sum() / total),
              "groups": group_results, "rows": rows, "employmentAvailable": employment_coeff is not None}
    if e is not None:
        result["employment"] = float(e.sum())
    return emit(result)
