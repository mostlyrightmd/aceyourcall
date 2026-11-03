import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.js";
import {
  researchCache,
  researchIdentity,
  validatedResearch,
  RESEARCH_RESERVE,
} from "../src/interviewer-research.js";
import { roomContext, roomProfile } from "../src/room-context.js";
const person = {
  name: "Example Person",
  linkedin: "https://www.linkedin.com/in/example",
};
test("research identity ignores application and private notes, coalesces canonical profile URLs", () => {
  assert.equal(
    researchIdentity({ ...person, notes: "private", application: "secret" }).id,
    researchIdentity({ ...person, linkedin: person.linkedin + "/" }).id,
  );
  assert.throws(() =>
    researchIdentity({ ...person, linkedin: "https://localhost/in/example" }),
  );
  assert.equal(researchIdentity({}), null);
});
test("research requires actual consulted sources and discards unsourced profiles", () => {
  const data = {
    matched: true,
    name: person.name,
    summary: "Investor",
    topics: ["Product"],
    sources: [{ title: "Profile", url: person.linkedin }],
    pronouns: "unknown",
  };
  assert.equal(validatedResearch(data, { output: [] }).matched, false);
  const result = validatedResearch(data, {
    output: [
      {
        type: "web_search_call",
        action: { sources: [{ url: person.linkedin }] },
      },
    ],
  });
  assert.equal(result.matched, true);
  assert.equal(result.voice, "cedar");
  assert.equal(result.photo, "");
});
test("cached jobs reserve once, do not run during calls, and never persist an application", async () => {
  const store = openStore(":memory:");
  let allowed = false,
    calls = 0,
    reserves = 0,
    release;
  const cache = researchCache(store, {
    available: () => allowed,
    reserve: () => reserves++,
    run: async (p) => {
      calls++;
      assert.deepEqual(Object.keys(p).sort(), ["linkedin", "name"]);
      await new Promise((r) => (release = r));
      return { matched: true, name: p.name };
    },
  });
  const first = cache.enqueue({
    ...person,
    application: "PRIVATE APPLICATION",
    notes: "PRIVATE NOTES",
  });
  assert.equal(cache.enqueue(person).id, first.id);
  await cache.tick();
  assert.equal(calls, 0);
  allowed = true;
  const work = cache.tick();
  await cache.tick();
  assert.equal(calls, 1);
  assert.equal(cache.get(first.id).status, "searching");
  assert.equal(store.all()[0].cost, RESEARCH_RESERVE);
  release();
  await work;
  await cache.tick();
  assert.equal(reserves, 1);
  assert.equal(cache.enqueue(person).status, "ready");
  assert.doesNotMatch(
    JSON.stringify(
      store.db.prepare("SELECT * FROM interviewer_research").all(),
    ),
    /PRIVATE/,
  );
  store.db.close();
});
test("budget rejection does not contact provider; interrupted requests keep reservation", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const c = researchCache(store, {
    available: () => true,
    reserve: () => {
      throw Error("cap");
    },
    run: async () => calls++,
  });
  const j = c.enqueue(person);
  await c.tick();
  assert.equal(calls, 0);
  assert.equal(c.get(j.id).status, "failed");
  assert.equal(store.all().length, 0);
  store.db.close();
});
test("researched identity, agenda and voice apply across interview difficulty without changing program", () => {
  const context = roomContext({
    application: "A submitted company application.",
    interviewer: { ...person, voice: "marin" },
  });
  const p = roomProfile(
    { id: "speedrun-10-hard", voice: "cedar", instructions: "Speedrun hard" },
    {
      ...context,
      research: {
        matched: true,
        name: "Example Person",
        voice: "cedar",
        summary: "Public infrastructure investor.",
        topics: ["Data quality"],
        sources: [],
        photo: "",
      },
    },
  );
  assert.equal(p.interviewer.name, person.name);
  assert.equal(p.voice, "marin");
  assert.match(p.instructions, /Data quality/);
  assert.match(p.instructions, /Speedrun hard/);
  assert.equal(
    roomProfile({ id: "yc-10", instructions: "YC" }, context).interviewer.name,
    person.name,
  );
});

test("a sourced namesake cannot satisfy a different requested LinkedIn identity", () => {
  const data = {
    matched: true,
    name: person.name,
    summary: "Investor",
    topics: [],
    sources: [
      {
        title: "Different person",
        url: "https://www.linkedin.com/in/namesake",
      },
    ],
  };
  const response = {
    output: [
      {
        type: "web_search_call",
        action: { sources: [{ url: data.sources[0].url }] },
      },
    ],
  };
  assert.equal(validatedResearch(data, response, person).matched, false);
});
test("startup deletes expired queued research even with no future requests", () => {
  const store = openStore(":memory:");
  const deps = {
    available: () => false,
    reserve: () => {},
    run: async () => {},
  };
  const first = researchCache(store, deps);
  const j = first.enqueue(person);
  j.updated = Date.now() - 31 * 86400000;
  store.db
    .prepare("UPDATE interviewer_research SET data=? WHERE id=?")
    .run(JSON.stringify(j), j.id);
  const restarted = researchCache(store, deps);
  assert.equal(restarted.get(j.id), null);
  store.db.close();
});

test("equivalent LinkedIn URL forms share the interviewer cache", () => {
  assert.equal(
    researchIdentity({
      name: "Alex  Smith",
      linkedin: "https://linkedin.com/in/alex/",
    }).id,
    researchIdentity({
      name: "Alex Smith",
      linkedin: "https://www.linkedin.com/in/alex",
    }).id,
  );
});
