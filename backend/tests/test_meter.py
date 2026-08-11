from app.meter import VERSION, analyse_line, analyse_poem

def meters(text): return [c["meter"] for c in analyse_line(text)["candidates"]]

def test_five_syllabotonics_and_r011():
    assert meters("ма`ма мы`ла ра`му")[0] == "Х"
    assert meters("луна` светла` всегда`")[0] == "Я"
    assert meters("ра`достно ра`достно")[0] == "Д"
    assert meters("доро`га доро`га")[0] == "Аф"
    assert meters("тишина` глубина`")[0] == "Ан"

def test_clauses():
    assert analyse_line("вода`")["clause"] == "м"
    assert analyse_line("во`да")["clause"] == "ж"
    assert analyse_line("во`дами")["clause"] == "д"
    assert analyse_line("во`дами-то")["clause"] == "г"

def test_tonic_fallbacks_and_accentual_last():
    assert "Дк" in meters("а` ба ба` ба ба ба`")
    assert "Тк" in meters("а` ба ба ба ба` ба ба ба ба`")
    assert analyse_line("а` ба ба ба ба ба` ба`")["candidates"][0]["meter"] == "Ак"

def test_coordinates_yo_unknown_and_no_external_suggestion():
    result=analyse_line("Ёлка, молоко ¦ свѣт!")
    assert result["syllables"][0]["stress"] == "stressed" and result["syllables"][0]["start"] == 0
    assert result["quality"] == "insufficient" and {w["text"] for w in result["unknownWords"]} >= {"молоко"}
    assert result["sourceHash"] and result["analyzerVersion"] == VERSION

def test_violations_anacrusis_and_empty():
    result=analyse_line("луна` мама")
    assert all("ictusOmissions" in c and "weakStresses" in c for c in result["candidates"])
    assert all("anacrusis" in c for c in result["candidates"])
    assert analyse_line("")["quality"] == "insufficient"

def test_poem_signature_order_and_warnings():
    poem=analyse_poem("p",[{"id":"2","text":"а` ба ба` ба ба ба`"},{"id":"1","text":"а` ба ба ба ба ба` ба` ¦"}])
    assert poem["lineSuggestions"][0]["lineId"] == "2" and poem["sourceSignature"]
    assert {w["rule"] for w in poem["warnings"]} >= {"R011","R017"}
    assert set(poem) >= {"metadataSuggestion","distribution","reviewLineIds","suggestedSegments"}

def test_shared_safe_tokenizer_keeps_internal_accents_and_boundaries():
    from app.stress import WORD
    samples=["моро`з","пого`да","говори`т","Моро`з — пого`да","се`веро-запа`дный","мѣ`сяцъ","моро`з¦"]
    for text in samples:
        result=analyse_line(text)
        expected=[(m.start(),m.end(),m.group()) for m in WORD.finditer(text)]
        actual=[(w["start"],w["end"],w["text"]) for w in result["words"]]
        assert actual==expected
        assert all(s["start"]>=actual[s["wordIndex"]][0] and s["end"]<=actual[s["wordIndex"]][1] for s in result["syllables"])

def test_all_quality_categories_and_accentual_is_never_exact():
    assert analyse_line("а` а`")["quality"]=="exact"
    accentual=analyse_line("а` ба ба ба ба ба` ба`")
    assert accentual["quality"]=="probable" and accentual["selected"]["meter"]=="Ак"
    assert accentual["selected"]["violations"] and not accentual["selected"]["regular"]
    assert analyse_line("а` ба ба` ба ба ба`")["quality"]=="ambiguous"
    assert analyse_line("молоко")["quality"]=="insufficient"
