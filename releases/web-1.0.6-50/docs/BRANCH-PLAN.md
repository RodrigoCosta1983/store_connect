# Plano da release com histórico independente

Esta alternativa usa um repositório local novo, sem pais e sem objetos da história F7. O nome local é release/storeconnect-web-1.0.6-50; ele está em outro repositório, distinto da release de mesmo nome baseada em F7. Nenhuma branch antiga foi renomeada, reescrita ou apagada. Os commits originais 68811ded964495d8ad1a4e4b8168ff5d398d0021, 379c592678edfb599833555735b2de5313406d4f, f9322cbe81b5b72204cbc680bea2b7eb6d580ac8 continuam preservados.

A branch comum F7 mantém ancestralidade, incluindo a exposição histórica; esta alternativa importa somente arquivos revisados, mantém sua procedência documental e perde a ancestralidade comum. A exposição das refs remotas antigas não desaparece. Não efetuar merge automático com main nem usar allow-unrelated-histories como atalho.

Os commits deste histórico novo separam fontes, testes/verificador e documentação. Seus hashes são novos por construção; não se trata de reescrita dos commits originais. O diretório app preserva os bytes publicados.

## Finalização futura

Revisar o relatório de automações; resolver limitações de acesso; obter escolha explícita desta alternativa e autorização de push; consultar a referência remota de mesmo nome; interromper se existir; enviar somente o HEAD independente para refs/heads/release/storeconnect-web-1.0.6-50, sem tags e sem force; confirmar o hash recebido. Não fazer merge ou deploy. Nenhuma dessas operações remotas foi executada.

Asaas operacional, novos escritores F9 e variantes F10 continuam separados no workspace original. Uma organização futura dessas frentes exige seleção própria. Não importar o Git original ou fazer fetch dele neste repositório novo, pois isso incorporaria objetos desnecessários; não adicionar .env, builds, caches, logs ou backups. Dependências opcionais já presentes nas fontes congeladas não equivalem a ativação dos escritores.
