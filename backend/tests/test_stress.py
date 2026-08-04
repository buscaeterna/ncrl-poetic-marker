from app.stress import DeterministicProvider, analyse_line

def test_lossless_format_and_existing_accents():
    result=analyse_line('«Моро`з — погода» ¦ ёлка\n', DeterministicProvider())
    assert result['suggested_text']=='«Моро`з — пого`да» ¦ ёлка\n'
    assert result['words'][0]['source']=='existing'
    assert result['words'][-1]['source']=='ё'

def test_unknown_and_homograph_require_review():
    result=analyse_line('замок крокозябра', DeterministicProvider())
    assert len(result['uncertain_words'])==2
    assert result['words'][0]['alternatives']==(3,)

def test_blank_is_preserved():
    assert analyse_line('   ', DeterministicProvider())['suggested_text']=='   '
