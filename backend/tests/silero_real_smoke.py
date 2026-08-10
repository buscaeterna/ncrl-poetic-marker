"""Real-model smoke test. Socket denial proves inference is offline."""
import socket
from app.model import SILERO, load_provider
from app.stress import analyse_line

provider=load_provider(SILERO)
def denied(*_args,**_kwargs): raise AssertionError("network access during inference")
socket.socket.connect=denied
cases={
 "На горе стоит старинный замок.":"На` горе` стои`т стари`нный за`мок.",
 "Мастер починил дверной замок.":"Ма`стер почини`л дверно`й замо`к.",
 "Мороз и погода.":"Моро`з и` пого`да.",
}
for source,expected in cases.items():
    actual=analyse_line(source,provider)["suggestedText"]
    assert actual==expected,(source,actual,expected)
print("Silero Stress real offline smoke passed")
