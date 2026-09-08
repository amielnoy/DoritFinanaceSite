import { test as base } from "@playwright/test";

/**
 * `test_step` — the annotation every spec in this suite uses to say, in words,
 * what a block of a test is doing.
 *
 * The message is not a comment: it is passed straight to Playwright's
 * `test.step()`, so it becomes a named node in the trace viewer, in the HTML
 * report and — because the Allure reporter consumes Playwright's native steps
 * — a step in the Allure report, with its own status, duration and any
 * attachment or failure captured underneath it. A failing test then points at
 * the sentence that failed instead of at a line number.
 *
 * Two forms, one behaviour:
 *
 *   // inline, inside a test body
 *   await test_step("the home page boots past the spinner", async () => {
 *     await gotoApp(page);
 *   });
 *
 *   // as a decorator on a page-object / helper method
 *   class ContactForm {
 *     @test_step("fill in the visitor's name and phone")
 *     async fillContactDetails(name: string, phone: string) { ... }
 *   }
 *
 * The decorator form takes the message the same way; omit it and the step is
 * named `Class.method`.
 */

type StepBody<T> = () => T | Promise<T>;

/** Matches both the TC39 (`value, context`) and legacy TypeScript decorators. */
type StepDecorator = (
  target: any,
  contextOrKey: any,
  descriptor?: PropertyDescriptor
) => any;

export function test_step<T>(message: string, body: StepBody<T>): Promise<T>;
export function test_step(message?: string): StepDecorator;
export function test_step<T>(
  message?: string,
  body?: StepBody<T>
): Promise<T> | StepDecorator {
  if (typeof body === "function") {
    return base.step(message ?? "step", body);
  }

  return function decorate(target: any, contextOrKey: any, descriptor?: PropertyDescriptor) {
    // Legacy decorators: (prototype, propertyKey, descriptor).
    if (descriptor && typeof descriptor.value === "function") {
      const original = descriptor.value;
      descriptor.value = function (this: any, ...args: any[]) {
        return base.step(stepName(message, this, contextOrKey), () => original.apply(this, args));
      };
      return descriptor;
    }

    // Standard decorators: (method, context) — the method is `target`.
    const original = target as (...args: any[]) => unknown;
    return function (this: any, ...args: any[]) {
      return base.step(stepName(message, this, contextOrKey?.name), () =>
        original.apply(this, args)
      );
    };
  };
}

function stepName(message: string | undefined, self: any, key: unknown): string {
  if (message) return message;
  const owner = self?.constructor?.name;
  return owner && owner !== "Object" ? `${owner}.${String(key)}` : String(key ?? "step");
}
