# Project chats

The sidebar lists chats with their project and task status. Select a chat to
open its project and song. New chat creates a separate conversation in the
current project. Beat drafts and message drafts stay with their chat.

Project agents keep running when their chat is closed or another project is
selected. Different projects can run tasks at the same time. A project allows
one task at a time, and manual saves wait until that task finishes. Editing and
playback remain available. Completed tasks preserve newer studio edits; reopen
the saved song to review the agent's version if the editor changed during a run.

Finish or stop Full Send and vocal generation, and save lyric edits, before
switching projects. Generation can continue while using other studios or the
library.

Chat history and drafts are saved on the current device, separately for each
hosted account. Closing the app stops active requests. An interrupted chat keeps
its prompt and tells the user to check saved changes before retrying. Native
agents recover conversation context from the saved transcript after a restart.

Recent projects survive restarts. Desktop keeps approved folder references in
its application data directory. Browser folders use IndexedDB directory handles
and may request folder permission again. Hosted projects use account-scoped
recent IDs and recheck access when reopening. The sidebar shows the 30 most
recent projects. Missing or moved folders show an error; open the folder again
to reconnect it. A clean saved song refreshes from disk when reopened, while
unsaved drafts remain intact.
