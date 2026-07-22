# Tasks

## How do I complete a task? (Employees)
1. Go to **Tasks** from the nav.
2. Find your assigned task.
3. If the task requires a photo, upload it.
4. Tap **Complete**.
5. Your DM is notified of the completion.

## How do I create a task? (DMs and above)
1. Go to **Tasks**.
2. Tap the **+** button or **Create Task**.
3. Enter a title and description.
4. Select the assignee (one of your employees).
5. Set a due date.
6. Optionally toggle **Photo Required** if you need proof of completion.
7. Save. The assignee gets a push notification.

## Can I create recurring tasks?
Yes. When creating a task, set it to recur daily, weekly, or monthly. The system automatically creates new task instances on the recurring schedule via a cron job that runs hourly.

## What happens when a task is overdue?
The system sends automatic reminder notifications for overdue tasks. A reminder cron runs daily at 9 AM ET and notifies assignees of tasks past their due date.

## Can I assign a task to multiple people?
Yes. When creating a task, you can select multiple assignees. A separate task is created for each person, so each person sees and completes their own copy independently.

## Who can see tasks?
All retail roles can see the Tasks page:
- **Employees** see tasks assigned to them.
- **DMs** see tasks they've created and tasks for their team.
- **SD, Owner, Developer** see all tasks across the org.

## Can I delete a task?
Yes. DMs, ops managers, SD, owners, and developers can delete tasks. You can delete a single task or select multiple tasks and bulk-delete them. For recurring tasks, you can delete just one instance or the entire series. Employees cannot delete tasks.
