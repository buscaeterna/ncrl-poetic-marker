from app.stress import DeterministicProvider, analyse_line

def test_lossless_format_and_existing_accents():
    result=analyse_line('«Моро`з — погода» ¦ ёлка\n', DeterministicProvider())
    assert result['suggestedText']=='«Моро`з — пого`да» ¦ ёлка\n'
    assert result['words'][0]['source']=='existing'
    assert result['words'][-1]['source']=='ё'

def test_unknown_and_homograph_require_review():
    result=analyse_line('замок крокозябра', DeterministicProvider())
    assert len(result['uncertainWords'])==2
    assert result['words'][0]['alternatives']==(3,)

def test_blank_is_preserved():
    assert analyse_line('   ', DeterministicProvider())['suggestedText']=='   '

def test_internal_backticks_are_one_immutable_token():
    for text in ['моро`з','пого`да','говори`т','Моро`з — пого`да','сине`-зелёный','моро`з ¦']:
        result=analyse_line(text,DeterministicProvider())
        assert result['suggestedText']==text
        assert all(word['source']=='existing' for word in result['words'])
        assert not result['uncertainWords']

def test_mixed_existing_and_new_stress():
    result=analyse_line('Моро`з — погода ¦ говорит',DeterministicProvider())
    assert result['suggestedText']=='Моро`з — пого`да ¦ говори`т'
    assert [word['source'] for word in result['words']]==['existing','dictionary','dictionary']
