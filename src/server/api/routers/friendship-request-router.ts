import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { authGuard } from '@/server/trpc/middlewares/auth-guard'
import { procedure } from '@/server/trpc/procedures'
import { IdSchema } from '@/utils/server/base-schemas'
import { router } from '@/server/trpc/router'

const SendFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canSendFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = SendFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('users')
      .where('users.id', '=', friendUserId)
      .select('id')
      .limit(1)
      .executeTakeFirstOrThrow(
        () =>
          new TRPCError({
            code: 'BAD_REQUEST',
          })
      )

    return next({ ctx })
  }
)

const AnswerFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canAnswerFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = AnswerFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('friendships')
      .where('friendships.userId', '=', friendUserId)
      .where('friendships.friendUserId', '=', ctx.session.userId)
      .where(
        'friendships.status',
        '=',
        FriendshipStatusSchema.Values['requested']
      )
      .select('friendships.id')
      .limit(1)
      .executeTakeFirstOrThrow(() => {
        throw new TRPCError({
          code: 'BAD_REQUEST',
        })
      })

    return next({ ctx })
  }
)

export const friendshipRequestRouter = router({
  send: procedure
    .use(canSendFriendshipRequest)
    .input(SendFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      /**
       * Question 3: Fix bug
       *
       * Fix a bug where our users could not send a friendship request after
       * they'd previously been declined. Steps to reproduce:
       *  1. User A sends a friendship request to User B
       *  2. User B declines the friendship request
       *  3. User A tries to send another friendship request to User B -> ERROR
       *
       * Instructions:
       *  - Go to src/server/tests/friendship-request.test.ts, enable the test
       * scenario for Question 3
       *  - Run `yarn test` to verify your answer
       */
      const userId = ctx.session.userId
      const friendUserId = input.friendUserId

      const existingRequest = await ctx.db
        .selectFrom('friendships')
        .where('userId', '=', userId)
        .where('friendUserId', '=', friendUserId)
        .where('status', '!=', 'accepted')
        .select(['status'])
        .executeTakeFirst()

      if (existingRequest) {
        await ctx.db
          .updateTable('friendships')
          .set({ status: 'requested' })
          .where('userId', '=', userId)
          .where('friendUserId', '=', friendUserId)
          .execute()
      } else {
        await ctx.db
          .insertInto('friendships')
          .values({
            userId: userId,
            friendUserId: friendUserId,
            status: 'requested',
          })
          .execute()
      }
    }),

  accept: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.userId
      await ctx.db.transaction().execute(async (t) => {
        /**
         * Question 1: Implement api to accept a friendship request
         *
         * When a user accepts a friendship request, we need to:
         *  1. Update the friendship request to have status `accepted`
         *  2. Create a new friendship request record with the opposite user as the friend
         *
         * The end result that we want will look something like this
         *
         *  | userId | friendUserId | status   |
         *  | ------ | ------------ | -------- |
         *  | 1      | 2            | accepted |
         *  | 2      | 1            | accepted |
         *
         * Instructions:
         *  - Your answer must be inside this transaction code block
         *  - Run `yarn test` to verify your answer
         *
         * Documentation references:
         *  - https://kysely-org.github.io/kysely/classes/Transaction.html#transaction
         *  - https://kysely-org.github.io/kysely/classes/Kysely.html#insertInto
         *  - https://kysely-org.github.io/kysely/classes/Kysely.html#updateTable
         */
        await t
          .updateTable('friendships')
          .set({ status: 'accepted' })
          .where('friendships.userId', '=', input.friendUserId)
          .where('friendships.friendUserId', '=', userId)
          .execute()

        const existingFriendship = await t
          .selectFrom('friendships')
          .selectAll()
          .where('userId', '=', userId)
          .where('friendUserId', '=', input.friendUserId)
          .executeTakeFirst()

        if (!existingFriendship) {
          await t
            .insertInto('friendships')
            .values({
              userId: userId,
              friendUserId: input.friendUserId,
              status: 'accepted',
            })
            .execute()
        } else {
          await t
            .updateTable('friendships')
            .set({ status: 'accepted' })
            .where('friendships.userId', '=', userId)
            .where('friendships.friendUserId', '=', input.friendUserId)
            .execute()
        }
      })
    }),

  decline: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      /**
       * Question 2: Implement api to decline a friendship request
       *
       * Set the friendship request status to `declined`
       *
       * Instructions:
       *  - Go to src/server/tests/friendship-request.test.ts, enable the test
       * scenario for Question 2
       *  - Run `yarn test` to verify your answer
       *
       * Documentation references:
       *  - https://vitest.dev/api/#test-skip
       */
      const userId = ctx.session.userId
      await ctx.db
        .updateTable('friendships')
        .set({ status: 'declined' })
        .where('friendships.userId', '=', input.friendUserId)
        .where('friendships.friendUserId', '=', userId)
        .execute()
    }),
})
