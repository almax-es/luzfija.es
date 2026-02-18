<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="es">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title><xsl:value-of select="/rss/channel/title"/> — Feed RSS</title>
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #0f0f0f;
            color: #e5e5e5;
            line-height: 1.6;
            padding: 2rem 1rem;
          }
          .container { max-width: 720px; margin: 0 auto; }
          .header {
            border-bottom: 1px solid #2a2a2a;
            padding-bottom: 1.5rem;
            margin-bottom: 2rem;
          }
          .rss-badge {
            display: inline-flex;
            align-items: center;
            gap: .4rem;
            background: #f26522;
            color: #fff;
            font-size: .75rem;
            font-weight: 700;
            letter-spacing: .05em;
            padding: .25rem .6rem;
            border-radius: 4px;
            margin-bottom: 1rem;
          }
          .rss-badge svg { width: 14px; height: 14px; fill: #fff; }
          h1 { font-size: 1.5rem; color: #fff; margin-bottom: .4rem; }
          .description { color: #999; font-size: .95rem; margin-bottom: 1rem; }
          .how-to {
            background: #1a1a1a;
            border: 1px solid #2a2a2a;
            border-radius: 8px;
            padding: 1rem 1.25rem;
            font-size: .875rem;
            color: #aaa;
          }
          .how-to strong { color: #e5e5e5; }
          .how-to a { color: #8B5CF6; }
          .items { display: flex; flex-direction: column; gap: 1rem; }
          .item {
            background: #1a1a1a;
            border: 1px solid #2a2a2a;
            border-radius: 8px;
            padding: 1.25rem;
          }
          .item-meta {
            display: flex;
            align-items: center;
            gap: .75rem;
            font-size: .8rem;
            color: #666;
            margin-bottom: .6rem;
          }
          .item-cat {
            background: #2a2a2a;
            color: #aaa;
            padding: .15rem .5rem;
            border-radius: 4px;
            text-transform: uppercase;
            font-size: .7rem;
            letter-spacing: .05em;
          }
          .item h2 { font-size: 1rem; margin-bottom: .5rem; }
          .item h2 a { color: #8B5CF6; text-decoration: none; }
          .item h2 a:hover { text-decoration: underline; }
          .item p { font-size: .9rem; color: #bbb; }
          .footer {
            margin-top: 2.5rem;
            padding-top: 1.5rem;
            border-top: 1px solid #2a2a2a;
            font-size: .8rem;
            color: #555;
            text-align: center;
          }
          .footer a { color: #8B5CF6; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="rss-badge">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/>
              </svg>
              Feed RSS
            </div>
            <h1><xsl:value-of select="/rss/channel/title"/></h1>
            <p class="description"><xsl:value-of select="/rss/channel/description"/></p>
            <div class="how-to">
              <strong>¿Cómo suscribirse?</strong> Copia la URL de esta página en tu lector de RSS favorito
              (por ejemplo <a href="https://feedly.com" target="_blank" rel="noopener">Feedly</a>,
              <a href="https://www.inoreader.com" target="_blank" rel="noopener">Inoreader</a> o
              <a href="https://netnewswire.com" target="_blank" rel="noopener">NetNewsWire</a>)
              para recibir las novedades automáticamente.
            </div>
          </div>
          <div class="items">
            <xsl:for-each select="/rss/channel/item">
              <div class="item">
                <div class="item-meta">
                  <span><xsl:value-of select="pubDate"/></span>
                  <xsl:if test="category">
                    <span class="item-cat"><xsl:value-of select="category"/></span>
                  </xsl:if>
                </div>
                <h2><a href="{link}"><xsl:value-of select="title"/></a></h2>
                <p><xsl:value-of select="description"/></p>
              </div>
            </xsl:for-each>
          </div>
          <div class="footer">
            <a href="https://luzfija.es/">← Volver a LuzFija.es</a>
          </div>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
