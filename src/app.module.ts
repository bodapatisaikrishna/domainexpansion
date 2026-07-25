import { McpApp, Module, ConfigModule } from '@nitrostack/core';

/**
 * Root Application Module — DomainExpansion.ai
 *
 * Reconstructs an enterprise's real API attack surface from access logs,
 * diffs it against a published OpenAPI contract to find shadow endpoints,
 * and reports authorization risk with citable log evidence.
 *
 * The `SurfaceModule` (src/modules/surface/) is wired in at Stage 8 once the
 * detection engine (src/engine/**) exists. Until then this boots with no
 * tools registered — that's expected at this stage.
 */
@McpApp({
    module: AppModule,
    server: {
        name: 'domainexpansion',
        version: '1.0.0'
    },
    logging: {
        level: 'info'
    }
})
@Module({
    name: 'domainexpansion',
    description: 'API attack-surface reconstruction and BOLA risk reporting from access logs',
    imports: [
        ConfigModule.forRoot(),
    ],
})
export class AppModule { }
