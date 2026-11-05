# PixGen AI

Site de geração de imagens com créditos, histórico, download e checkout do Mercado Pago. Todos os arquivos da aplicação ficam diretamente nesta pasta raiz, sem subpastas.

## O que o site faz

O visitante escreve um prompt, escolhe formato e qualidade e gera uma imagem. Cada geração usa 1 crédito. O saldo aparece no cabeçalho e na seção de créditos. A imagem fica visível, pode ser baixada como PNG e entra no histórico.

O valor é R$ 1,00 por crédito. O checkout usa Mercado Pago Checkout Pro. O servidor cria uma preferência, recebe notificações, consulta o pagamento pela API e credita somente pagamentos com status `approved`. O processamento foi feito para ser idempotente, portanto a mesma notificação não adiciona créditos novamente.

## Publicar no Vercel

1. Envie estes arquivos para um repositório ou use o Vercel para importar a pasta.
2. No projeto Vercel, crie uma integração PostgreSQL. Ela fornece uma variável de conexão, como `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL` ou `NEON_DATABASE_URL`.
3. Em **Settings → Environment Variables**, adicione somente estas duas variáveis manuais:
   - `OPENAI_API_KEY`: sua chave privada de geração de imagens.
   - `MP_ACCESS_TOKEN`: seu token privado do Mercado Pago.
4. Marque as variáveis para Production e Preview conforme necessário e faça um novo deploy. A Vercel só aplica alterações de variáveis em novos deployments.
5. No painel do Mercado Pago, configure o Webhook para `https://SEU-DOMINIO.vercel.app/api/webhook` e selecione eventos de pagamentos.
6. Faça um pagamento de teste e confirme no banco e no saldo.

Não coloque tokens em `index.html`, `app.js`, no repositório ou em qualquer variável com prefixo `NEXT_PUBLIC_`/`VITE_`. O servidor é o único lugar que lê as chaves.

## Rodar localmente

Use Node.js 20 ou superior. Instale as dependências com `pnpm install`, copie `.env.example` para `.env` e preencha as duas chaves. Para testar créditos de forma persistente localmente, configure também uma conexão PostgreSQL no ambiente. Sem banco, o modo local usa memória e começa com 3 créditos apenas para demonstração; em produção na Vercel o banco é obrigatório.

Depois, execute `pnpm dev` e abra `http://localhost:3000`.

## Observações importantes

A integração armazena a imagem em formato base64 no PostgreSQL para manter o histórico simples e autocontido. Para grande volume, substitua esse campo por armazenamento de objetos e guarde apenas a URL no banco. O custo real da API de imagens é separado do preço cobrado no site; ajuste o preço ou a margem antes de vender em escala.

O cartão de pagamento permanece no ambiente do Mercado Pago. O token privado nunca vai para o navegador. A página de retorno também consulta o pagamento no servidor e não credita saldo apenas porque o usuário voltou para o site.
