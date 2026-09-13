import type { RuntimeIdentity } from "./core/runtimeIdentity.js";

export interface BootstrapDependencies<TStore> {
  loadIdentity: () => Readonly<RuntimeIdentity>;
  initializeStore: () => Promise<TStore>;
  startRuntime: (store: TStore, identity: Readonly<RuntimeIdentity>) => Promise<void>;
}

export async function bootstrapApplication<TStore>(dependencies: BootstrapDependencies<TStore>): Promise<void> {
  const identity = dependencies.loadIdentity();
  const store = await dependencies.initializeStore();
  await dependencies.startRuntime(store, identity);
}
