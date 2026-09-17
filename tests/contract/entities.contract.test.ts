import { describe, expect, it } from "vitest";
import { entityNames, loadEntity, type EntitySchema } from "../helpers/entity-schema";

const names = entityNames();

describe("base44 entity definitions", () => {
  it("ships the entities the frontend depends on", () => {
    expect(names).toEqual(["BlogPost", "Contact", "Lead", "Testimonial", "User"]);
  });

  for (const name of names) {
    describe(name, () => {
      const schema: EntitySchema = loadEntity(name);

      it("is a well-formed object entity whose name matches its filename", () => {
        expect(schema.name).toBe(name);
        expect(schema.type).toBe("object");
        expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
      });

      it("declares only supported property types", () => {
        for (const [key, prop] of Object.entries(schema.properties)) {
          expect(
            ["string", "number", "boolean", "object", "array"],
            `${name}.${key}`
          ).toContain(prop.type);
        }
      });

      it("lists only declared properties as required", () => {
        for (const key of schema.required ?? []) {
          expect(Object.keys(schema.properties), `${name}.required`).toContain(key);
        }
      });

      it("keeps enum values and defaults consistent with each other", () => {
        for (const [key, prop] of Object.entries(schema.properties)) {
          if (prop.enum) {
            expect(prop.enum.length, `${name}.${key}.enum`).toBeGreaterThan(0);
            if (prop.default !== undefined) {
              expect(prop.enum, `${name}.${key}.default`).toContain(prop.default);
            }
          }
          if (prop.minimum !== undefined && prop.maximum !== undefined) {
            expect(prop.minimum).toBeLessThanOrEqual(prop.maximum);
          }
        }
      });
    });
  }
});

// RLS is the only thing standing between the public contact form and the
// private lead inbox. These assertions are the security contract of the app.
describe("row-level security contract", () => {
  it("Lead: anyone may submit, only admins may read/update/delete", () => {
    const rls = loadEntity("Lead").rls as Record<string, any>;
    expect(rls.create).toBe(true);
    for (const op of ["read", "update", "delete"] as const) {
      expect(rls[op]?.user_condition?.role, `Lead.rls.${op}`).toBe("admin");
    }
  });

  it("BlogPost: world-readable, admin-writable", () => {
    const rls = loadEntity("BlogPost").rls as Record<string, any>;
    expect(rls.read).toBe(true);
    for (const op of ["create", "update", "delete"] as const) {
      expect(rls[op]?.user_condition?.role, `BlogPost.rls.${op}`).toBe("admin");
    }
  });

  it("no entity is left world-writable by accident", () => {
    for (const name of names) {
      const rls = (loadEntity(name).rls ?? {}) as Record<string, any>;
      for (const op of ["update", "delete"] as const) {
        expect(rls[op], `${name}.rls.${op} must not be public`).not.toBe(true);
      }
    }
  });
});
