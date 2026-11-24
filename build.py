# baut index.html aus src/
s = open('src/app.html').read()
s = s.replace('/*LOOPJS*/', open('src/loop.js').read()).replace('/*BEATJS*/', open('src/beat.js').read())
open('index.html', 'w').write(s)
