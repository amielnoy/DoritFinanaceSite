import { vi } from "vitest";

/**
 * Shared stub for the Base44 SDK client. Component tests never touch the
 * network; they assert on what the component *asks* the client to do.
 */
export const base44Mock = {
  entities: {
    Lead: { create: vi.fn(async (p: unknown) => ({ id: "lead-1", ...(p as object) })) },
    Testimonial: {
      list: vi.fn(async () => []),
      create: vi.fn(async (p: unknown) => ({ id: "t-1", ...(p as object) })),
      delete: vi.fn(async () => ({ ok: true })),
    },
    BlogPost: {
      list: vi.fn(async () => []),
      filter: vi.fn(async () => []),
      get: vi.fn(async () => null),
    },
  },
  integrations: {
    Core: {
      SendEmail: vi.fn(async () => ({ status: "sent" })),
      UploadFile: vi.fn(async () => ({ file_url: "https://example.test/f.png" })),
    },
  },
  functions: { invoke: vi.fn(async () => ({ ok: true })) },
  auth: { me: vi.fn(async () => null) },
};

export const resetBase44Mock = () => {
  base44Mock.entities.Lead.create.mockClear();
  base44Mock.integrations.Core.SendEmail.mockClear();
  base44Mock.functions.invoke.mockClear();
  base44Mock.entities.Testimonial.list.mockClear();
};
