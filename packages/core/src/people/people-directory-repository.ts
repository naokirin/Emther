export type PeopleDirectoryPersistedState = {
  entries: [string, string][]; // [name, id][]
  canonical?: [string, string][]; // [id, name][]
  counter: number;
  acknowledgedUnmasked?: string[];
  archived?: string[];
};

export type PeopleDirectoryRepository = {
  load(): PeopleDirectoryPersistedState;
  peek(): PeopleDirectoryPersistedState | undefined;
  save(state: PeopleDirectoryPersistedState): void;
};
