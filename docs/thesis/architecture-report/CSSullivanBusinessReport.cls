%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Sullivan Business Report
% LaTeX Class
% Version 1.0 (May 5, 2022)
%
% This class originates from:
% https://www.LaTeXTemplates.com
%
% Author:
% Vel (vel@latextemplates.com)
%
% License:
% CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

%----------------------------------------------------------------------------------------
%	CLASS CONFIGURATION
%----------------------------------------------------------------------------------------

\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{CSSullivanBusinessReport}[2022/05/05 Creodocs Sullivan Business Report Class v1.0]

\usepackage{etoolbox} % Required for conditional logic and easily changing commands

\newtoggle{unnumberedsections} % Create toggle for a class option
\settoggle{unnumberedsections}{false} % Default value for the class option
\DeclareOption{unnumberedsections}{\settoggle{unnumberedsections}{true}} % Set the class option toggle if the class option was used in the template

\DeclareOption*{\PassOptionsToClass{\CurrentOption}{article}} % Pass through any extra options specified to the base class
\ProcessOptions\relax % Process class options

\LoadClass{article} % Load the base class

%----------------------------------------------------------------------------------------
%	REQUIRED PACKAGES AND MISC CONFIGURATIONS
%----------------------------------------------------------------------------------------

\usepackage{graphicx} % Required for including images
\graphicspath{{Images/}{./}} % Specifies where to look for included images (trailing slash required)

\setlength{\parindent}{0pt} % Paragraph indentation
\setlength{\parskip}{10pt} % Vertical space between paragraphs

% The original template uses footmisc to tune footnote placement. The local
% thesis build keeps standard LaTeX footnotes to avoid an optional package
% dependency in TinyTeX.

% The original template uses ragged2e for global ragged-right text. Standard
% LaTeX alignment is sufficient for this report and avoids a missing optional
% footnote dependency in the local TinyTeX installation.

% Optional template package removed for the local thesis build.

\AtBeginEnvironment{quote}{\itshape\rmfamily} % Style quotations

% Optional appendix styling package removed for the local thesis build.

\usepackage{float} % Allows more precisely positioning floats e.g. \begin{figure}[H]

%----------------------------------------------------------------------------------------
%	MARGINS
%----------------------------------------------------------------------------------------

\usepackage[
	top=3cm, % Top margin
	bottom=3cm, % Bottom margin
	left=2cm, % Left margin
	right=2cm, % Right margin
	marginparwidth=1.2cm, % Width of optional right margin content
	marginparsep=0.5cm, % Padding between text and margin content
	footskip=1.5cm, % Space from the bottom margin to the baseline of the footer
	headsep=0.8cm, % Space from the top margin to the baseline of the header
	headheight=1cm, % Height of the header
	%showframe % Uncomment to show frames around the margins for debugging purposes
]{geometry}

\NewDocumentCommand{\sidenote}{o o +m}{\footnote{#3}}

\newenvironment{fullwidth}{ % Environment to output to the full page width (excluding page margins)
	\par\begingroup
}{
	\par\endgroup
}

\newenvironment{twothirdswidth}{ % Environment to output content at two-thirds of the whole page width
	\par\begingroup
}{
	\par\endgroup
}

% Calculate the full text width (i.e. including the large right margin and margin padding)
\newlength{\fulltextwidth}
\setlength{\fulltextwidth}{\dimexpr\textwidth+\marginparwidth+\marginparsep\relax}

\newcommand{\nonumsidenote}[2][]{\sidenote[\hspace{0pt}][#1]{#2}} % New command to output an unnumbered sidenote, the optional argument is a vertical offset and the required parameter is the sidenote text

\newcommand{\sidenotequote}[2][]{\sidenote[\hspace{0pt}][#1]{\rmfamily\itshape#2}} % New command to output a quotation sidenote, the optional argument is a vertical offset and the required parameter is the quotation text

%----------------------------------------------------------------------------------------
%	FONTS
%----------------------------------------------------------------------------------------

\usepackage[utf8]{inputenc} % Required for inputting international characters
\usepackage[T1]{fontenc} % Output font encoding for international characters

% The original Palatino font package is omitted for local TinyTeX portability.

% The original template uses IBM Plex font packages. The local build uses the
% installed Palatino-based defaults so the report remains portable.

\newcommand{\textel}[1]{{\fontseries{el}\selectfont #1}} % Define a simple command for using the ExtraLight weight
\newcommand{\textl}[1]{{\fontseries{l}\selectfont #1}} % Define a simple command for using the Light weight
\newcommand{\textsb}[1]{{\fontseries{sb}\selectfont #1}} % Define a simple command for using the SemiBold weight

%----------------------------------------------------------------------------------------
%	HEADERS AND FOOTERS
%----------------------------------------------------------------------------------------

\pagestyle{plain}

\usepackage{calc} % Allows arithmetic in LaTeX commands
\newlength{\marginoffset}
\setlength{\marginoffset}{\marginparwidth + \marginparsep} % Calculate width of margin and buffer space before margin
% Header/footer offsets from the original template are omitted without fancyhdr.

%----------------------------------------------------------------------------------------
%	SECTIONS
%----------------------------------------------------------------------------------------

% Optional title formatting package removed for the local thesis build.

\iftoggle{unnumberedsections}{ % Conditional logic for the unnumbered sections class options
	\setcounter{secnumdepth}{0} % Don't number sections at any level
}{
	\setcounter{secnumdepth}{3} % Number sections down to subsubsections
}

% Standard article section formatting is used.

%----------------------------------------------------------------------------------------
%	TABLE OF CONTENTS
%----------------------------------------------------------------------------------------

% Optional table-of-contents formatting package removed for the local build.

\setcounter{tocdepth}{2} % Show entries in the table of contents down to subsections

\renewcommand{\contentsname}{Table of Contents} % Rename the table of contents section heading

% Standard article table of contents formatting is used.

%----------------------------------------------------------------------------------------
%	COLORS
%----------------------------------------------------------------------------------------

\usepackage[usenames, svgnames]{xcolor} % Required for defining and using custom colors

%\definecolor{cyan}{RGB}{0, 255, 255} % Define custom colors in this format

%----------------------------------------------------------------------------------------
%	BIBLIOGRAPHY
%----------------------------------------------------------------------------------------

\usepackage[
	backend=bibtex, % Use BibTeX because biber is not installed in the local TinyTeX setup
	citestyle=numeric, % In-text citation style
	bibstyle=numeric, % Bibliography style
]{biblatex}

\newcommand{\sidecite}[2][0pt]{\sidenote[][#1]{\textcite{#2}}} % Parenthetical citations in the margin
\newcommand{\fullsidecite}[2][0pt]{\sidenote[][#1]{\fullcite{#2}}} % Full citations in the margin

%----------------------------------------------------------------------------------------
%	TABLES
%----------------------------------------------------------------------------------------

\usepackage{booktabs} % Required for better horizontal rules in tables

\usepackage{array} % Required for manipulating table columns
\renewcommand{\arraystretch}{1.25} % Increase the height of table rows

\newcolumntype{R}[1]{>{\raggedleft\arraybackslash}p{#1}} % Define a new right-aligned paragraph column type
\newcolumntype{L}[1]{>{\raggedright\arraybackslash}p{#1}} % Define a new left-aligned (no justification) paragraph column type
\newcolumntype{C}[1]{>{\centering\arraybackslash}p{#1}} % Define a new centered paragraph column type

%----------------------------------------------------------------------------------------
%	CAPTIONS
%----------------------------------------------------------------------------------------

% Standard LaTeX captions are used.

%----------------------------------------------------------------------------------------
%	LISTS
%----------------------------------------------------------------------------------------

\usepackage{enumitem} % Required for list customization

\setlist{itemsep=0pt, topsep=0pt} % Customize spacing around and inside lists

\renewcommand{\labelenumi}{\arabic{enumi}.} % Customize the first level numbered list characters
\renewcommand{\labelenumii}{\alph{enumii}.} % Customize the second level numbered list characters
\renewcommand{\labelenumiii}{\roman{enumiii}.} % Customize the third level numbered list characters

\renewcommand{\labelitemi}{\Large\raisebox{-1.5pt}{\textbullet}} % Customize the first level bullet point character
\renewcommand{\labelitemii}{\Large\raisebox{-1.5pt}{--}} % Customize the second level bullet point character
\renewcommand{\labelitemiii}{\Large\raisebox{-1.5pt}{-}} % Customize the third level bullet point character

%----------------------------------------------------------------------------------------
%	LINKS
%----------------------------------------------------------------------------------------

\usepackage{hyperref} % Required for links

\hypersetup{
	colorlinks=true, % Whether to color the text of links
	urlcolor=black, % Color for \url and \href links
	linkcolor=black, % Color for \nameref links
	citecolor=black, % Color of reference citations
}

%----------------------------------------------------------------------------------------
%	CODE LISTINGS
%----------------------------------------------------------------------------------------

% Code listings are not used in this report.

%----------------------------------------------------------------------------------------
%	CUSTOM COMMANDS
%----------------------------------------------------------------------------------------

\newcommand{\reporttitle}[1]{\renewcommand{\reporttitle}{#1}}
\newcommand{\reportsubtitle}[1]{\renewcommand{\reportsubtitle}{#1}}
\newcommand{\reportauthors}[1]{\renewcommand{\reportauthors}{#1}}
\newcommand{\reportdate}[1]{\renewcommand{\reportdate}{#1}}

\newcommand{\rightheadercontent}[1]{\renewcommand{\rightheadercontent}{#1}}
