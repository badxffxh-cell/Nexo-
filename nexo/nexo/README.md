# Nexo

Chat em tempo real para devs e comunidade, no estilo Discord. Node.js + Express + WebSocket, sem build e sem banco de dados.

## Rodar no seu computador

```
npm install
npm start
```

Abra http://localhost:3000 (use duas abas com apelidos diferentes para ver o tempo real).

## Publicar para todo mundo (grátis, no Render)

1. Crie uma conta em https://github.com e um repositório novo. Envie esta pasta para ele:
   ```
   git init
   git add .
   git commit -m "Nexo"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/nexo.git
   git push -u origin main
   ```
2. Crie uma conta em https://render.com e clique em **New > Web Service**.
3. Conecte o repositório. O Render lê o `render.yaml` e já preenche tudo
   (build `npm install`, start `npm start`).
4. Clique em **Deploy**. Em alguns minutos você recebe uma URL como `https://nexo.onrender.com`.
   É só mandar o link para as pessoas.

Funciona também em Railway, Fly.io, Koyeb ou qualquer VPS com Node 18+ (WebSocket precisa estar liberado, e todos esses suportam).

### Limitações do plano grátis

- O serviço "dorme" depois de uns 15 minutos sem acesso e leva cerca de um minuto para acordar.
- O disco é temporário: o histórico (`data.json`) é apagado a cada novo deploy ou reinício.
  Para guardar o histórico, use um disco persistente (plano pago do Render, volume no Fly.io/Railway)
  e aponte a variável `DATA_DIR` para ele, por exemplo `DATA_DIR=/data`.

## Variáveis de ambiente

| Variável | Para que serve |
| --- | --- |
| `PORT` | Porta do servidor (a hospedagem define sozinha) |
| `DATA_DIR` | Pasta onde o `data.json` é salvo |

## Proteções já incluídas

- Limite de 6 mensagens a cada 8 segundos por conexão e de 8 conexões por IP
- Máximo de 500 usuários online, 2000 caracteres por mensagem, 25 canais por servidor
- Apelido único entre os usuários online e nomes reservados (admin, bot etc.)
- Todo texto é escapado antes de aparecer na tela (sem injeção de HTML)
- Só aceita conexões WebSocket vindas do próprio site
- Cabeçalhos de segurança e conexões mortas derrubadas automaticamente

## O que ainda não existe

- Conta com senha: qualquer pessoa pode usar qualquer apelido que não esteja online no momento.
- Moderação (banir, apagar mensagem de outros). Hoje cada pessoa só apaga as próprias mensagens.
- Mensagens diretas, upload de imagem e canais de voz.
