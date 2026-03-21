"""
Name variant generator.
Produces canonical, initials, surname-first, and common alternate forms.
"""

import re


def generate_variants(full_name: str) -> list:
    """
    Generate all likely name variants for fuzzy matching.
    Returns list of dicts: [{"variant": "...", "type": "..."}]
    """
    if not full_name or not full_name.strip():
        return []

    variants = []
    name = full_name.strip()

    # 1. Canonical form (title case)
    canonical = name.title()
    variants.append({"variant": canonical, "type": "canonical"})

    # 2. Uppercase form
    variants.append({"variant": name.upper(), "type": "uppercase"})

    # 3. Lowercase form
    variants.append({"variant": name.lower(), "type": "lowercase"})

    # Split into parts
    parts = name.split()
    if len(parts) < 2:
        return variants

    # 4. Initials form: "R. K. Sharma" for "Ramesh Kumar Sharma"
    if len(parts) >= 2:
        initials = [f"{p[0].upper()}." for p in parts[:-1]]
        initials_form = " ".join(initials) + " " + parts[-1].title()
        variants.append({"variant": initials_form, "type": "initials"})

    # 5. Surname-first form: "Sharma, Ramesh Kumar"
    if len(parts) >= 2:
        surname_first = f"{parts[-1].title()}, {' '.join(p.title() for p in parts[:-1])}"
        variants.append({"variant": surname_first, "type": "surname_first"})

    # 6. First + Last only (drop middle names): "Ramesh Sharma"
    if len(parts) >= 3:
        first_last = f"{parts[0].title()} {parts[-1].title()}"
        variants.append({"variant": first_last, "type": "first_last"})

    # 7. First name initial + surname: "R. Sharma"
    if len(parts) >= 2:
        first_initial = f"{parts[0][0].upper()}. {parts[-1].title()}"
        variants.append({"variant": first_initial, "type": "first_initial_surname"})

    # 8. Without common prefixes/suffixes
    prefixes = {"mr", "mrs", "ms", "dr", "prof", "shri", "smt", "sri"}
    lower_parts = [p.lower() for p in parts]
    if lower_parts[0].rstrip(".") in prefixes and len(parts) > 1:
        clean_name = " ".join(parts[1:]).title()
        variants.append({"variant": clean_name, "type": "no_prefix"})

    return variants
