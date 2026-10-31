# Store&Connect Web 1.0.6+50 — histórico independente

Este ramo foi preparado em um repositório local novo, sem pais F7 e sem importar objetos do Git antigo. As fontes Web preservadas estão em **app/**. Os três commits locais anteriores continuam intactos no repositório original de preparação. Os hashes antigos citados nos documentos são apenas referências textuais de procedência; não são pais nem objetos incorporados neste histórico.

O snapshot contém fontes, assets, configuração pública, quatro testes aprovados e seu verificador. Não contém credenciais privadas, builds, backups, dados reais ou workflows de deploy. Os 182 arquivos da aplicação/testes têm os mesmos bytes da captura validada. Confira source-manifest.json e execute node scripts/verify-source.cjs para uma conferência offline, sem build ou acesso remoto.

A versão Web publicada é 1.0.6+50, com bundle SHA256 cde6da845f9ef51c8595a8026e26b27ef76acf97ac7449c08d06c359455869d8. Flutter 3.32.6 / Dart 3.8.1; entrypoint app/lib/main_prod.dart; COMMERCIAL_CHECKOUT_V2=false. Módulos opcionais de compilação já presentes nas fontes congeladas não autorizam ativação de novos escritores F9/F10. Não usar esta captura para publicar Android.

**Somente local: nenhum push autorizado.** O gate documental depende da decisão do proprietário sobre esta alternativa e da conclusão da conferência de automações externas. A chave Sandbox histórica não integra os objetos deste novo repositório, mas sua exposição nas refs antigas permanece. Consulte docs/SECURITY-PENDING.md e docs/BRANCH-PLAN.md.

O build anterior e os testes funcionais aprovados não foram repetidos. Limites e resultados estão em docs/VALIDATION.md. As fontes e o lockfile foram copiados sem reformatação; um build futuro exige SDK compatível e não tem garantia de identidade binária entre ambientes. Nenhum deploy é feito pelos scripts incluídos.
