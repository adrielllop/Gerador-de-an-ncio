PIXELIA — VERSÃO COM CRÉDITOS SALVOS POR DISPOSITIVO

Somente DUAS chaves secretas obrigatórias:
1. OPENAI_API_KEY
2. MERCADOPAGO_ACCESS_TOKEN

PUBLICAÇÃO:
1. Envie todos os arquivos da raiz para o GitHub.
2. Importe o repositório na Vercel.
3. Em Settings > Environment Variables, adicione OPENAI_API_KEY e MERCADOPAGO_ACCESS_TOKEN.
4. 5. Faça Redeploy.
6. Configure o webhook Mercado Pago para https://SEU-DOMINIO/api/webhook.

CARTEIRA:
O saldo e a lista de pagamentos já resgatados ficam no armazenamento local do navegador (localStorage). Não há cadastro, login nem Supabase. O saldo fica naquele navegador/dispositivo. Se limpar os dados do navegador, trocar de navegador ou aparelho, o saldo não acompanha.

PAGAMENTO:
O site cria Checkout Pro com a API do Mercado Pago. Quando o cliente volta ao site, o servidor consulta o pagamento diretamente na API e só devolve créditos se o status estiver approved, o valor corresponder à recarga e a referência indicar o dispositivo que iniciou a compra. Quantidades inteiras de 1 a 10.000. Descontos: 1–9 sem desconto; 10–24 5%; 25–49 8%; 50–99 12%; 100+ 15%.

LIMITAÇÃO IMPORTANTE:
Como você escolheu armazenar créditos somente no dispositivo e não usar banco de dados, o saldo local pode ser apagado ou manipulado pelo próprio usuário. A lista de pagamentos resgatados também é local; não existe uma base central para impedir tentativas avançadas de reutilização de comprovantes em outros navegadores. Isso é uma solução simples para protótipo/baixo risco, não uma carteira antifraude para operação comercial de grande escala.

Nunca exponha as chaves no HTML/JavaScript. Use somente variáveis de ambiente da Vercel.

CORREÇÃO DO ERRO PNPM:
Se a Vercel mostrar ERR_PNPM_OUTDATED_LOCKFILE, remova o arquivo pnpm-lock.yaml antigo do repositório GitHub e faça commit. Este pacote não inclui pnpm-lock.yaml e usa apenas express e openai. Depois, na Vercel, faça Redeploy. Se o painel oferecer a opção, marque Clear Build Cache.
