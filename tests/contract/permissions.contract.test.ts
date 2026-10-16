import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, canManage, grantableRoles } from "../../src/config/permissions";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * src/config/permissions.ts chooses what the screens show; the Edge Functions
 * and the database decide. This holds the two to one table
 * (docs/superpowers/specs/2026-10-15-agency-roles-design.md): a gate that
 * moves without the table, or the table without the gate, fails here.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const fn = (name: string) => read(`supabase/functions/${name}/handler.ts`);
const narrowing = read("supabase/migrations/20261030000000_agency_roles_narrowing.sql");
const additive = read("supabase/migrations/20261029000000_agency_roles_additive.sql");

describe("the permissions table matches the gates that decide", () => {
  it("assigning a lead is Admin+ in assign-lead", () => {
    expect(PERMISSIONS["leads.assign"]).toBe("admin");
    expect(fn("assign-lead")).toContain("allowRole(session, agencyId, 'admin', rid, log)");
    expect(additive).toMatch(/public\.has_role\(old\.agency_id, 'admin'\) or public\.is_admin\(\)/);
  });

  it("deleting a lead and reading contacts are Admin+ in the policies", () => {
    expect(PERMISSIONS["leads.delete"]).toBe("admin");
    expect(PERMISSIONS["contacts.read"]).toBe("admin");
    expect(narrowing).toMatch(/create policy leads_delete_admin[\s\S]*?using \(public\.has_role\(agency_id, 'admin'\) or public\.is_admin\(\)\)/);
    expect(narrowing).toMatch(/create policy contacts_read_admin[\s\S]*?using \(public\.has_role\(agency_id, 'admin'\) or public\.is_admin\(\)\)/);
  });

  it("a User works their own leads: status, transcripts, documents and the clearinghouse", () => {
    for (const action of ["leads.readOwn", "leads.changeStatus", "transcripts.read", "claimDocuments.open", "masleka.reveal", "masleka.publish", "masleka.create"] as const) {
      expect(PERMISSIONS[action], action).toBe("user");
    }
    expect(fn("claim-document-link")).toContain("allowLead(session, leadId, rid, log)");
    expect(fn("masleka-reveal")).toContain("allowRequest(session, requestId, rid, log)");
    expect(fn("masleka-create")).toContain("allowRole(session, AGENCY_1, 'user', rid, log)");
    expect(narrowing).toMatch(/clearinghouse_publish[\s\S]*?public\.can_work_snapshot\(p_snapshot\)/);
  });

  it("drafts are any member's; publishing, deleting and testimonials are Admin+ in content-admin", () => {
    expect(PERMISSIONS["blog.writeDraft"]).toBe("user");
    expect(PERMISSIONS["blog.publish"]).toBe("admin");
    expect(PERMISSIONS["blog.delete"]).toBe("admin");
    expect(PERMISSIONS["testimonials.write"]).toBe("admin");
    const content = fn("content-admin");
    expect(content).toContain("draft?.published ? 'admin' : 'user'");
    expect(content).toMatch(/op === 'removeArticle' \? 'blog_posts' : 'testimonials', filter\), 'admin'\)/);
    expect(content).toMatch(/case 'createTestimonial': \{\s*const stop = await refused\(session, null, 'admin'\)/);
  });

  it("a shared-library article is the operator's alone", () => {
    expect(PERMISSIONS["blog.sharedLibrary"]).toBe("operator");
    expect(fn("content-admin")).toMatch(/typeof row\.agency_id === 'string' \? row\.agency_id : null/);
  });

  it("inviting is Admin+, an Admin grants User only, and only an Owner grants Admin or Owner", () => {
    expect(PERMISSIONS["members.manageUsers"]).toBe("admin");
    expect(PERMISSIONS["members.manageAdmins"]).toBe("owner");
    expect(PERMISSIONS["members.transferOwnership"]).toBe("owner");
    expect(fn("invite-user")).toContain("allowRole(session, orgId, 'admin', rid, log)");
    expect(fn("invite-user")).toContain("!session.isOperator && gate.role !== 'owner' && role !== 'user'");
    expect(additive).toMatch(/elsif v_mine = 'admin' then\s+if p_role <> 'user' or \(v_old is not null and v_old <> 'user'\)/);
    expect(grantableRoles("admin", false)).toEqual(["user"]);
    expect(grantableRoles("owner", false)).toEqual(["owner", "admin", "user"]);
  });

  it("the agency profile is the Owner's", () => {
    expect(PERMISSIONS["agencyProfile.edit"]).toBe("owner");
    expect(narrowing).toMatch(/create policy agency_profiles_update_owner[\s\S]*?using \(public\.has_role\(agency_id, 'owner'\) or public\.is_admin\(\)\)/);
  });

  it("the membership history is Admin+", () => {
    expect(PERMISSIONS["audit.read"]).toBe("admin");
    expect(additive).toMatch(/membership_events_read_admin[\s\S]*?public\.has_role\(agency_id, 'admin'\) or public\.is_admin\(\)/);
  });
});

describe("can, grantableRoles and canManage", () => {
  it("ranks owner over admin over user", () => {
    expect(can("user", false, "leads.assign")).toBe(false);
    expect(can("admin", false, "leads.assign")).toBe(true);
    expect(can("owner", false, "leads.assign")).toBe(true);
    expect(can("admin", false, "agencyProfile.edit")).toBe(false);
    expect(can("owner", false, "agencyProfile.edit")).toBe(true);
  });

  it("gives no role nothing, and the operator everything but leaving an agency they are not in", () => {
    expect(can(null, false, "leads.readOwn")).toBe(false);
    expect(can(null, true, "agencyProfile.edit")).toBe(true);
    expect(can(null, true, "blog.sharedLibrary")).toBe(true);
    expect(can("owner", false, "blog.sharedLibrary")).toBe(false);
    expect(can(null, true, "members.leave")).toBe(false);
    expect(can("user", true, "members.leave")).toBe(true);
  });

  it("lets nobody change someone above what they may grant", () => {
    expect(grantableRoles("user", false)).toEqual([]);
    expect(grantableRoles(null, true)).toEqual(["owner", "admin", "user"]);
    expect(canManage("admin", false, "user")).toBe(true);
    expect(canManage("admin", false, "admin")).toBe(false);
    expect(canManage("admin", false, "owner")).toBe(false);
    expect(canManage("owner", false, "owner")).toBe(true);
    expect(canManage("user", false, "user")).toBe(false);
  });
});
