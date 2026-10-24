import styled, { keyframes } from "styled-components";

const ellipsisAnimation = keyframes`
  0% { clip-path: inset(0 100% 0 0); }
  33% { clip-path: inset(0 66% 0 0); }
  66% { clip-path: inset(0 33% 0 0); }
  100% { clip-path: inset(0); }
`;

export const AnimatedEllipsis = styled.span`
  display: inline-block;
  /* Reveal dots without resizing their text box: narrow animated widths can
     wrap the dots under the chat shell's overflow-wrap rule. */
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;

  &::after {
    content: "...";
    display: inline-block;
    overflow: hidden;
    vertical-align: bottom;
    animation: ${ellipsisAnimation} 2s steps(1, end) infinite;
    width: 1em;
    height: 1em;
  }
`;

export default AnimatedEllipsis;
