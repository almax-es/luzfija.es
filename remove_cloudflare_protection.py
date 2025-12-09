#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para eliminar la protección de email de Cloudflare
y restaurar los emails originales en archivos HTML.

Uso:
    python remove_cloudflare_protection.py archivo.html
    
El script creará un backup (.bak) antes de modificar el archivo.
"""

import re
import sys
import shutil
from pathlib import Path


def remove_cloudflare_protection(file_path, email="hola@luzfija.es"):
    """
    Elimina la protección de Cloudflare y restaura el email original.
    
    Args:
        file_path: Ruta al archivo HTML
        email: Email original a restaurar (default: hola@luzfija.es)
    """
    file_path = Path(file_path)
    
    if not file_path.exists():
        print(f"❌ Error: El archivo '{file_path}' no existe")
        return False
    
    # Crear backup
    backup_path = file_path.with_suffix(file_path.suffix + '.bak')
    shutil.copy2(file_path, backup_path)
    print(f"✅ Backup creado: {backup_path}")
    
    # Leer contenido
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_content = content
    
    # 1. Eliminar el script de Cloudflare email decode
    cloudflare_script_pattern = r'<script[^>]*data-cfasync="false"[^>]*src="/cdn-cgi/scripts/[^"]+/cloudflare-static/email-decode\.min\.js"[^>]*></script>'
    content = re.sub(cloudflare_script_pattern, '', content)
    
    # 2. Reemplazar enlaces ofuscados del tipo: /cdn-cgi/l/email-protection#...
    # Patrón para href="/cdn-cgi/l/email-protection#..."
    email_protection_pattern = r'href="/cdn-cgi/l/email-protection#[a-f0-9]+"'
    content = re.sub(email_protection_pattern, f'href="mailto:{email}"', content)
    
    # 3. Reemplazar spans con __cf_email__ por el email real
    # Patrón: <span class="__cf_email__" data-cfemail="...">&#91;email&#160;protected&#93;</span>
    cf_email_span_pattern = r'<span class="__cf_email__"[^>]*data-cfemail="[^"]*"[^>]*>&#91;email&#160;protected&#93;</span>'
    content = re.sub(cf_email_span_pattern, email, content)
    
    # También el patrón alternativo: <span class="__cf_email__" ...>[email protected]</span>
    cf_email_span_pattern2 = r'<span class="__cf_email__"[^>]*>.*?\[email.*?protected.*?\].*?</span>'
    content = re.sub(cf_email_span_pattern2, email, content, flags=re.DOTALL)
    
    # 4. Limpiar líneas vacías múltiples que puedan quedar
    content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)
    
    # Verificar si hubo cambios
    if content == original_content:
        print("⚠️  No se encontraron cambios de Cloudflare en el archivo")
        return True
    
    # Guardar archivo modificado
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"✅ Archivo limpio guardado: {file_path}")
    print(f"📧 Email restaurado: {email}")
    
    # Estadísticas de cambios
    changes = []
    if 'email-decode.min.js' not in content and 'email-decode.min.js' in original_content:
        changes.append("- Script de Cloudflare eliminado")
    if 'cdn-cgi/l/email-protection' not in content and 'cdn-cgi/l/email-protection' in original_content:
        changes.append("- Enlaces de protección reemplazados")
    if '__cf_email__' not in content and '__cf_email__' in original_content:
        changes.append("- Spans ofuscados reemplazados")
    
    if changes:
        print("\n📋 Cambios realizados:")
        for change in changes:
            print(f"  {change}")
    
    return True


def main():
    if len(sys.argv) < 2:
        print("Uso: python remove_cloudflare_protection.py <archivo.html> [email]")
        print("\nEjemplo:")
        print("  python remove_cloudflare_protection.py index1.html")
        print("  python remove_cloudflare_protection.py index1.html contact@example.com")
        sys.exit(1)
    
    file_path = sys.argv[1]
    email = sys.argv[2] if len(sys.argv) > 2 else "hola@luzfija.es"
    
    print("=" * 60)
    print("🧹 Limpiador de protección Cloudflare")
    print("=" * 60)
    print(f"📄 Archivo: {file_path}")
    print(f"📧 Email a restaurar: {email}")
    print("-" * 60)
    
    success = remove_cloudflare_protection(file_path, email)
    
    print("-" * 60)
    if success:
        print("✅ Proceso completado exitosamente")
    else:
        print("❌ Proceso finalizado con errores")
    print("=" * 60)


if __name__ == "__main__":
    main()
