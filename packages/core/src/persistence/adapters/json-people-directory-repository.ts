import {
  createSecureJsonSingletonDocument,
} from "../json-document";
import type {
  PeopleDirectoryPersistedState,
  PeopleDirectoryRepository,
} from "../../people/people-directory-repository";

const EMPTY: PeopleDirectoryPersistedState = { entries: [], counter: 0 };
const doc = createSecureJsonSingletonDocument<PeopleDirectoryPersistedState>(
  "people-directory.json",
  EMPTY,
);

export function createJsonPeopleDirectoryRepository(): PeopleDirectoryRepository {
  return {
    load: () => doc.load(),
    peek: () => doc.peek(),
    save: (state) => doc.save(state),
  };
}
