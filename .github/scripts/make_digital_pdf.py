from pathlib import Path
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',b'<< /Length 111 >>\nstream\nBT /F1 18 Tf 72 700 Td (First synthetic poetic line) Tj 0 -30 Td (Second synthetic poetic line) Tj ET\nendstream',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
data=bytearray(b'%PDF-1.4\n');offsets=[]
for i,obj in enumerate(objects,1):offsets.append(len(data));data.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
xref=len(data);data.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode());data.extend(b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets));data.extend(f'trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode());Path('/tmp/digital.pdf').write_bytes(data)
