import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from pipeline.parse_email import parse, object_id

FIX = pathlib.Path(__file__).parent / "fixtures"

def test_object_id_decodes():
    assert object_id("RXhjaGFuZ2VPYmplY3Q6Njg3ODQyMXw4OTdiYThjNGU1NDA1MjQ2Y2RkNDdmOWMzMDhiNWJmMDI0YTk5NjlhZDBjOGI1NTkzM2M2NjZkZmY2NTJmMWQ3NGI4ZTdjY2FkZGY0NjIwYzdlMzkxM2Y4ZDA3ZDEwMjk4NmJiM2Q0YzFjNWVkNWU3NzUwYmU5YmQzNzFkNWUzZXw5MDc1NDk") == "6878421"

def test_six_listing_email():
    ls = parse((FIX / "six.txt").read_text())
    assert [l["id"] for l in ls] == ["6878421", "6878557", "6878603", "6878662", "6878698", "6878746"]
    first = ls[0]
    assert first["street"] == "Van Eeghenstraat 26 1"
    assert first["postcode"] == "1071GG"
    assert first["price"] == 699000 and first["price_terms"] == "kosten koper"
    assert first["type"] == "Bovenwoning" and first["m2"] == 69 and first["rooms"] == 3 and first["bedrooms"] == 2
    assert first["price_per_m2"] == 10130
    assert first["url"].startswith("https://move.nl/exchange-object/")
    assert ls[3]["bedrooms"] == 3 and ls[3]["type"] == "Benedenwoning"

def test_one_listing_email():
    ls = parse((FIX / "one.txt").read_text())
    assert len(ls) == 1
    assert ls[0]["street"] == "Derde Egelantiersdwarsstraat 20 2" and ls[0]["m2"] == 126 and ls[0]["price"] == 600000

def test_two_listing_email():
    ls = parse((FIX / "two.txt").read_text())
    assert [(l["street"], l["price"], l["m2"]) for l in ls] == [
        ("Sumatraplantsoen 5 F", 525000, 80), ("Joos Banckersplantsoen 116", 725000, 98)]
    assert all(l["email_sent"].startswith("Friday, August 28, 2026") for l in ls)
