"""Executed inside the Linux API image: asserts semantics, not just startup."""
from app.meter import analyse_line

trochee = analyse_line("ма`ма мы`ла ра`му")
dolnik = analyse_line("а` ба ба` ба ба ба`")
assert trochee["selected"]["meter"] == "Х", trochee
assert any(candidate["meter"] == "Дк" for candidate in dolnik["candidates"]), dolnik
assert trochee["sourceHash"] and trochee["quality"] != "insufficient"
print("meter container smoke: Х and Дк candidates verified")
