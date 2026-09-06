"""Deterministic one-sentence buyer summary, used as a fallback when the scheduled
session has not written a better one from the full description."""
import re


def summary(l: dict) -> str:
    bits = []
    own = l.get("ownership") or ""
    lease = l.get("leasehold_details") or {}
    until = next((v for k, v in lease.items() if "afgekocht" in k.lower()), None)
    if own.startswith("freehold"):
        bits.append("Freehold")
    elif own.startswith("leasehold"):
        if until and re.search(r"eeuwig", str(until), re.I):
            bits.append("leasehold bought off in perpetuity")
        elif until:
            y = (re.search(r"\d{4}", str(until)) or [None])[0]
            bits.append(f"leasehold paid until {y}" if y else "leasehold")
        else:
            bits.append("leasehold (canon not yet checked)")
    head = " ".join(x for x in [
        f'{l.get("m2")} m²' if l.get("m2") else None,
        (l.get("type") or "apartment"),
        f'from {l["build_year"]}' if l.get("build_year") else None,
        f'on the {l["floor"]}' if l.get("floor") else None,
    ] if x)
    extras = []
    if l.get("bedrooms"): extras.append(f'{l["bedrooms"]} bedrooms')
    if l.get("outdoor") and l["outdoor"].lower() != "none": extras.append(l["outdoor"].lower())
    elif l.get("outdoor"): extras.append("no outdoor space")
    if l.get("energy_label"): extras.append(f'energy label {l["energy_label"]}')
    if l.get("vve_monthly"): extras.append(f'VvE €{l["vve_monthly"]}/month')
    if l.get("price_per_m2"): extras.append(f'€{l["price_per_m2"]:,}/m²'.replace(",", "."))
    lead = bits[0][0].upper() + bits[0][1:] if bits else ""
    s = f"{lead}, {head}" if lead and not lead.startswith("Freehold") else f"{lead} {head}".strip()
    if extras: s += ": " + ", ".join(extras)
    if l.get("status") and l["status"] != "available": s += f' ({l["status"]})'
    return s.strip() + "."


def outdoor(l: dict) -> str | None:
    parts = []
    if (l.get("balcony") or "").lower().startswith("y"): parts.append("Balcony")
    if (l.get("roof_terrace") or "").lower().startswith("y"): parts.append("Roof terrace")
    g = (l.get("garden") or "")
    if g and not g.lower().startswith("no"): parts.append("Garden" + (f" ({g})" if len(g) < 30 else ""))
    if l.get("outdoor_m2") and parts: parts[-1] += f' {l["outdoor_m2"]}'
    return ", ".join(parts) if parts else ("None" if g else None)
