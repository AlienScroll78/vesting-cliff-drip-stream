import type { Meta, StoryObj } from "@storybook/react";
import {
  ClaimButton,
  ConfirmCancelModal,
  ScheduleCard,
  TimelineChart
} from "./components";

const meta = {
  title: "Vesting UI"
} satisfies Meta;

export default meta;

export const ScheduleCardSnapshot: StoryObj = {
  name: "Schedule card",
  render: () => <ScheduleCard />
};

export const ClaimButtonReadySnapshot: StoryObj = {
  name: "Claim button ready",
  render: () => <ClaimButton />
};

export const ClaimButtonDisabledSnapshot: StoryObj = {
  name: "Claim button disabled",
  render: () => <ClaimButton disabled />
};

export const TimelineChartSnapshot: StoryObj = {
  name: "Timeline chart",
  render: () => <TimelineChart />
};

export const ModalSnapshot: StoryObj = {
  name: "Cancel modal",
  render: () => <ConfirmCancelModal />
};
