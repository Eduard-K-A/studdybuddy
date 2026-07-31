
/**
 * ibl.ai Redux store.
 *
 * This standalone store holds the RTK Query API cache and (optionally)
 * chat / file‑upload slices. Import and wrap your app with:
 *
 *   import { iblaiStore } from "@/store/iblai-store";
 *   <Provider store={iblaiStore}>…</Provider>
 *
 * If you already have a Redux store, merge the reducers and middleware
 * from this file into yours instead.
 */

import { configureStore } from "@reduxjs/toolkit";
import {
  coreApiSlice,
  mentorReducer,
  mentorMiddleware,
} from "@iblai/iblai-js/data-layer";
import {
  chatSliceReducerShared,
  filesReducer,
} from "@iblai/iblai-js/web-utils";

import { quizApi } from "./quiz-api";
import { quizReducer } from "./quiz-slice";

export const iblaiStore = configureStore({
  reducer: {
    // Core API cache (auth, tenant, user metadata, etc.)
    [coreApiSlice.reducerPath]: coreApiSlice.reducer,

    // Mentor/chat API slices
    ...mentorReducer,

    // Shared chat state (messages, streaming, sessions)
    chatSliceShared: chatSliceReducerShared,

    // File upload state
    files: filesReducer,

    // StudyBuddy: quiz backend cache + session state.
    // Registered on the SDK's own store rather than a second one — a separate
    // store would sit under a different ReactReduxContext and the SDK's RTK
    // Query hooks would silently return undefined.
    [quizApi.reducerPath]: quizApi.reducer,
    quiz: quizReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false })
      .concat(coreApiSlice.middleware)
      .concat(...mentorMiddleware)
      .concat(quizApi.middleware),
});

export type IblaiRootState = ReturnType<typeof iblaiStore.getState>;
export type IblaiAppDispatch = typeof iblaiStore.dispatch;
